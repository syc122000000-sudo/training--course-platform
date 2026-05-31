export const courseBlueprint = {
  course: {
    id: "course-engineer-training",
    title: "上岸包",
    subtitle: "工程师能力训练",
    bannerNote: "共 6 节课"
  },
  lessons: [
    {
      lessonNo: 1,
      title: "AI 基础",
      dateLabel: "6月1日",
      summary: "AI、Agent 基础概念 · Agent 产品选择与基础配置",
      assignmentTitle: "第 1 节练习",
      assignmentContent: "用 3 到 5 句话解释 Transformer、Token、Prompt 三个概念，并给出一个适合新手的 Agent 使用场景。",
      handoutTitle: "课程讲义",
      handoutBody: [
        "# 第 1 节 AI 基础",
        "",
        "本讲义用于帮助学员快速建立对 AI 训练、使用与 Agent 相关概念的统一认知。",
        "",
        "## 讲解要点",
        "- Transformer / Token / Tokenizer",
        "- Prompt / System Prompt / Structured Output",
        "- Planning / Tool Use / Guardrails",
        ""
      ].join("\n")
    },
    {
      lessonNo: 2,
      title: "需求理解",
      dateLabel: "6月5日",
      summary: "需求拆解、场景分析、范围界定与信息补全",
      assignmentTitle: "第 2 节练习",
      assignmentContent: "把一个模糊需求拆成目标、边界、约束、风险四个部分，并写出你会先确认的 3 个问题。",
      handoutTitle: "课程讲义",
      handoutBody: [
        "# 第 2 节 需求理解",
        "",
        "本节重点是把业务需求翻译成可执行、可验证的工程任务。",
        "",
        "## 讲解要点",
        "- 需求拆解",
        "- 边界确认",
        "- 验收条件",
        ""
      ].join("\n")
    },
    {
      lessonNo: 3,
      title: "前端开发",
      dateLabel: "6月8日（全天2节）",
      summary: "页面结构、组件组织、交互流转与响应式布局",
      assignmentTitle: "第 3 节练习",
      assignmentContent: "设计一个课程列表组件，要求支持选中态、进度态和移动端自适应展示。",
      handoutTitle: "课程讲义",
      handoutBody: [
        "# 第 3 节 前端开发",
        "",
        "本节聚焦页面结构、组件拆分和交互反馈。",
        "",
        "## 讲解要点",
        "- 布局骨架",
        "- 状态管理",
        "- 响应式策略",
        ""
      ].join("\n")
    },
    {
      lessonNo: 4,
      title: "后端开发",
      dateLabel: "6月12日（全天2节）",
      summary: "接口设计、权限控制、文件访问与数据持久化",
      assignmentTitle: "第 4 节练习",
      assignmentContent: "设计课程平台的 5 个核心接口，并写出每个接口的输入、输出与权限要求。",
      handoutTitle: "课程讲义",
      handoutBody: [
        "# 第 4 节 后端开发",
        "",
        "本节聚焦 API 设计、鉴权与文件受控访问。",
        "",
        "## 讲解要点",
        "- 数据模型",
        "- 受控下载",
        "- 提交记录",
        ""
      ].join("\n")
    },
    {
      lessonNo: 5,
      title: "数据库应用",
      dateLabel: "6月15日",
      summary: "课程、课节、资源、作业、提交记录的数据建模",
      assignmentTitle: "第 5 节练习",
      assignmentContent: "画出课程平台的数据表关系，并标出课程、课节、资源和提交记录之间的关联。",
      handoutTitle: "课程讲义",
      handoutBody: [
        "# 第 5 节 数据库应用",
        "",
        "本节聚焦表结构、关系约束和查询设计。",
        "",
        "## 讲解要点",
        "- 主键与外键",
        "- 一对多关系",
        "- 查询与索引",
        ""
      ].join("\n")
    },
    {
      lessonNo: 6,
      title: "上线部署 · 数据观测 · Skill封装",
      dateLabel: "6月22日",
      summary: "部署策略、运行观测、封装可复用能力",
      assignmentTitle: "第 6 节练习",
      assignmentContent: "列出课程平台上线前的部署、监控和回滚检查清单，并标注优先级。",
      handoutTitle: "课程讲义",
      handoutBody: [
        "# 第 6 节 上线部署 · 数据观测 · Skill封装",
        "",
        "本节聚焦如何把课程平台变成可持续运行的工程产品。",
        "",
        "## 讲解要点",
        "- 部署环境",
        "- 日志与观测",
        "- 能力封装",
        ""
      ].join("\n")
    }
  ]
};
