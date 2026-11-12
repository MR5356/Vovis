use crate::error::AppError;
use std::error::Error;

/// Keep credentials, request URLs and proxy addresses out of user-facing errors.
/// Only inspect the source chain to select an actionable, fixed diagnostic.
fn network_hint(error: &dyn Error, timeout: bool, connect: bool) -> &'static str {
    if timeout {
        return "请求超时，请检查网络接入状态、系统代理和该域名的访问策略后重试";
    }
    let mut detail = String::new();
    let mut source = Some(error);
    while let Some(error) = source {
        detail.push_str(&error.to_string().to_ascii_lowercase());
        detail.push(' ');
        source = error.source();
    }
    if [
        "certificate",
        "unknownissuer",
        "unknown issuer",
        "cert verify",
    ]
    .iter()
    .any(|part| detail.contains(part))
    {
        "HTTPS 证书验证失败，请检查系统时间及系统信任证书；若使用 aTrust 等企业网络客户端，请联系管理员检查证书配置"
    } else if ["proxy", "tunnel"].iter().any(|part| detail.contains(part)) {
        "系统代理连接失败，请检查代理配置及企业网络客户端的连接状态"
    } else if ["dns", "resolve", "name or service not known", "nodename"]
        .iter()
        .any(|part| detail.contains(part))
    {
        "域名解析失败，请检查 DNS 及企业网络客户端的域名访问策略"
    } else if connect {
        "无法建立连接，请检查系统代理、网络接入状态和该域名的访问策略（包括 aTrust 等企业网络客户端）"
    } else {
        "网络请求中断，请检查网络接入状态后重试"
    }
}

pub(crate) fn feishu_network_error(
    operation: &str,
    host: &str,
    error: &reqwest::Error,
) -> AppError {
    AppError::Invalid(format!(
        "{operation}请求失败（{host}）：{}",
        network_hint(error, error.is_timeout(), error.is_connect())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_certificate_proxy_and_dns_without_exposing_details() {
        for (detail, expected) in [
            (
                "invalid peer certificate: UnknownIssuer token=private",
                "证书验证失败",
            ),
            (
                "proxy http://user:password@proxy.internal failed",
                "系统代理连接失败",
            ),
            ("dns error: private.internal", "域名解析失败"),
        ] {
            let error = std::io::Error::other(detail);
            let hint = network_hint(&error, false, true);
            assert!(hint.contains(expected), "{hint}");
            assert!(!hint.contains("private"));
            assert!(!hint.contains("password"));
        }
    }

    #[tokio::test]
    async fn timeout_reports_service_host_without_request_secrets() {
        // A listening socket that never reads provides a deterministic response timeout.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let error = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_millis(100))
            .build()
            .unwrap()
            .get(format!("http://{address}/private?token=secret"))
            .send()
            .await
            .unwrap_err();
        let message = feishu_network_error("飞书认证", "accounts.feishu.cn", &error).to_string();
        assert!(message.contains("accounts.feishu.cn"));
        assert!(message.contains("请求超时"));
        assert!(!message.contains("secret"));
        assert!(!message.contains("private"));
        assert!(!message.contains(&address.to_string()));
    }
}
