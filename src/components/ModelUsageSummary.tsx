import type { ModelUsage } from "../domain/sessionUsage";

const number = new Intl.NumberFormat("zh-CN");

function amount(row: ModelUsage) {
  if (!row.calls) return "未调用";
  const parts: string[] = [];
  if (row.type === "TTS")
    parts.push(`提交合成 ${number.format(row.characters)} 字符`);
  if (row.total !== undefined)
    parts.push(`已回报 ${number.format(row.total)} tokens`);
  if (row.input !== undefined)
    parts.push(`输入 ${number.format(row.input)} tokens`);
  if (row.output !== undefined)
    parts.push(`输出 ${number.format(row.output)} tokens`);
  if (row.type === "LLM" && !row.reportedCalls) parts.push("Token 用量未回报");
  if (row.reportedCalls && row.reportedCalls < row.calls)
    parts.push(`${row.reportedCalls}/${row.calls} 次有用量回报`);
  return parts.join(" · ");
}

export function ModelUsageSummary({
  rows,
  demo,
}: {
  rows?: ModelUsage[];
  demo: boolean;
}) {
  return (
    <section className="model-usage">
      <h3>本场模型用量</h3>
      {rows?.length ? (
        <dl>
          {rows.map((row) => (
            <div key={JSON.stringify([row.type, row.model])}>
              <dt>
                <span>{row.type}</span> {row.model}
              </dt>
              <dd>
                {row.calls > 0 && `${number.format(row.calls)} 次 · `}
                {amount(row)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>
          {demo
            ? "模拟演讲未调用模型"
            : rows
              ? "本场未调用模型"
              : "此记录未采集模型用量"}
        </p>
      )}
    </section>
  );
}
