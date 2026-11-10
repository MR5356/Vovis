import type { Slide, Connection, WorkspaceData } from "./workspace";
const initialSlides: Slide[] = [
  {
    title: "从零理解 AI Agent 架构",
    kind: "cover",
    script:
      "大家好，欢迎来到今天的技术分享。接下来的二十五分钟，我们会从一个简单问题出发：Agent 如何从理解目标，走到完成任务？随后，我们一起看看它的核心架构与实际应用。",
  },
  {
    title: "今天，我们聊什么？",
    script:
      "今天的分享分为三个部分。首先理解 Agent 的基本概念，然后拆解一次任务的执行过程，最后讨论实际落地中的设计取舍。讲解结束后，我会留出时间回答大家的问题。",
  },
  {
    title: "AI Agent 是什么？",
    script:
      "可以把 Agent 理解为围绕目标自主推进任务的系统。它不仅生成一段回答，还会利用工具、维护上下文，并根据结果决定下一步行动。",
  },
  {
    title: "核心组成与架构",
    script:
      "一个典型的 Agent 系统由模型、工具和记忆组成。模型负责理解与决策，工具提供行动能力，记忆保存上下文。编排层将它们组织成一个可持续执行的循环。",
  },
  {
    title: "Agent 如何完成一次任务？",
    kind: "flow",
    script:
      "接下来我们看，Agent 是如何完成一次任务的。首先，它会理解任务，也就是把用户的目标转化为可执行的需求，明确需要做什么、达到什么结果。\n\n随后，Agent 会进行规划执行：根据任务拆解出合理的步骤，并选择合适的工具来完成，比如查询信息、调用接口或处理数据等。\n\n最后，Agent 会根据执行结果进行反馈迭代，不断检查是否达成目标，并在必要时调整计划、再次执行，直到任务完成为止。",
  },
  {
    title: "常见工具与应用",
    script:
      "工具将模型与真实业务连接起来。例如查询知识库、调用业务接口，以及处理文件。设计工具时，需要明确输入、输出和错误信息，让执行结果可以被验证。",
  },
  {
    title: "实践案例：从需求到交付",
    script:
      "以生成一份技术报告为例，Agent 先确认受众与主题，再检索资料、组织结构、完成初稿，并检查引用和结论。每一步都需要有清晰的完成标准。",
  },
  {
    title: "可靠性，是落地的关键",
    script:
      "真实应用里，需要关注失败重试、权限边界和人工接管。我们应当记录关键执行过程，对不可逆操作设置明确边界，让系统在遇到不确定性时能够停止并请求帮助。",
  },
  {
    title: "总结与问答",
    kind: "end",
    script:
      "今天我们讨论了 Agent 的任务理解、规划执行和反馈迭代，也介绍了模型、工具与记忆的作用。接下来是问答时间，欢迎提出你的问题。感谢大家参与。",
  },
];
export const defaults: WorkspaceData = {
  pdfAssetId: "",
  pdfName: "",
  meetingUrl: "",
  groupId: "",
  materialIds: [] as string[],
  projectMaterials: [] as {
    id: string;
    title: string;
    content: string;
    updatedAt: string;
  }[],
  title: "从零理解 AI Agent 架构",
  audience: "研发与技术团队",
  minutes: 25,
  tone: "自然、专业",
  slides: initialSlides,
  page: 4,
  notes:
    "项目资料：本次分享介绍通用 Agent 架构，不涉及具体产品性能或商业承诺。\n\n术语：Agent / 工具调用 / 上下文 / 反馈迭代。",
  connections: [
    {
      id: "llm",
      name: "通用语言模型",
      type: "LLM",
      vendor: "OpenAI 兼容接口",
      url: "https://api.example.com/v1",
      model: "your-model",
    },
    {
      id: "asr",
      name: "实时语音识别",
      type: "ASR",
      vendor: "豆包",
      url: "",
      model: "流式识别模型",
    },
    {
      id: "tts",
      name: "主播声音",
      type: "TTS",
      vendor: "豆包",
      url: "",
      model: "语音合成模型",
    },
  ] as Connection[],
  bindings: { script: "llm", qa: "llm", asr: "asr", tts: "tts" },
};
