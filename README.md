# 培训课程收录平台

这是一个单体 Node 应用，前端页面和后端 API 在同一个服务里运行。第一阶段不拆前后端，部署最简单，适合没有服务器、希望直接外网分享、并且后续可以通过 GitHub 热更新的人。

部署方案已经固定为：

- 代码仓库：GitHub
- 应用托管：Render
- 数据库：Supabase Postgres
- 附件存储：Cloudflare R2
- 更新方式：本地改代码后 `git push`，Render 自动重建

## 先说最重要的结论

如果你只是想知道最终怎么上线，可以记住这 4 件事：

1. 代码放 GitHub
2. Render 负责把网站跑起来
3. Supabase 存用户、课程、提交记录等数据库信息
4. Cloudflare R2 存视频、课件、作业附件

## 为什么第一阶段不拆前后端

现在故意不拆前后端，原因很直接：

1. 你没有服务器，也不是开发人员，先把部署复杂度降到最低更重要。
2. 前端和接口在同一个域名下，登录、文件预览、下载、权限控制最稳。
3. GitHub 推送后只需要 Render 重建一个服务，不需要前端一套、后端一套分别维护。
4. 现阶段访问量不会大到必须拆服务，先保证能上线、能维护、能热更新。

## 本地运行

### 1. 环境要求

- Node.js 22 或更高版本
- Git

你现在机器里已经是 Node 24，可以直接用。

### 2. 本地配置加载顺序

程序会按下面顺序读取配置：

1. 系统环境变量
2. 项目根目录 `.env`
3. `config/local-config.json`
4. 代码默认值

这意味着：

- 你本地最推荐直接用 `.env`
- 如果你已经有 `config/local-config.json`，也能继续用
- 同一个变量如果同时存在，以环境变量优先

### 3. 本地 `.env` 示例

如果你只是本地调试，不接线上数据库，`.env` 可以先写成：

```bash
PORT=3230
SESSION_DAYS=7
DATABASE_FILE=runtime/training-course-platform.sqlite
STORAGE_PROVIDER=local
STORAGE_DIR=runtime/storage
```

如果你本地也想直连线上 Supabase 和 R2，可以写成：

```bash
PORT=3230
SESSION_DAYS=7
DATABASE_URL=你的 Supabase 连接串
DATABASE_SSL_MODE=require
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=你的 Cloudflare Account ID
R2_ACCESS_KEY_ID=你的 R2 Access Key ID
R2_SECRET_ACCESS_KEY=你的 R2 Secret Access Key
R2_BUCKET=你的 Bucket 名称
APP_BASE_URL=http://127.0.0.1:3230
```

### 4. 本地启动命令

```bash
npm install
npm start
```

启动后打开：

```text
http://127.0.0.1:3230
```

本地默认账号：

- 管理员：`admin` / `admin123`
- 学员：`student` / `student123`

## 一次性部署总流程

第一次上线，严格按这个顺序做：

1. 把代码传到 GitHub
2. 去 Supabase 创建数据库
3. 去 Cloudflare 创建 R2 存储桶
4. 去 Render 部署项目
5. 打开公网地址测试管理员和学员流程

不要跳步。尤其不要先在 Render 里乱填变量，再回头补数据库和 R2。

## 第 1 步：把代码传到 GitHub

### 1. 在 GitHub 创建仓库

1. 打开 GitHub
2. 登录你的账号
3. 点击右上角 `+`
4. 选择 `New repository`
5. `Repository name` 填一个名字，例如 `training-course-platform`
6. 选择 `Public` 或 `Private`
7. 点击 `Create repository`

### 2. 在本地推送代码

在项目根目录执行：

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin 你的仓库地址
git push -u origin main
```

说明：

- `你的仓库地址` 就是 GitHub 新仓库页面提供的地址
- 如果之前已经初始化过 Git，就不要重复执行 `git init`

如果推送失败，优先检查：

- 你是否安装了 Git
- 你是否已经登录 GitHub
- 仓库地址是否复制正确

## 第 2 步：创建 Supabase 数据库

### 1. 创建项目

1. 打开 `https://supabase.com`
2. 登录
3. 点击 `New project`
4. 选择你的组织
5. `Project name` 填一个名字，例如 `training-course-platform`
6. `Database Password` 设置一个你能记住的密码
7. `Region` 尽量选离中国大陆更近的区域
8. 点击 `Create new project`
9. 等待项目初始化完成

### 2. 初始化数据库表

1. 左侧菜单点击 `SQL Editor`
2. 点击 `New query`
3. 打开本项目里的 `deploy/supabase-schema.sql`
4. 把文件内容全部复制进 SQL 编辑器
5. 点击 `Run`

执行成功后，数据库表就建好了。

### 3. 复制 `DATABASE_URL`

1. 左侧进入 `Project Settings`
2. 点击 `Database`
3. 下拉找到 `Connection string`
4. 找到 `URI`
5. 点击复制
6. 把里面的 `[YOUR-PASSWORD]` 替换成你创建项目时设置的数据库密码

示例格式：

```bash
postgresql://postgres.xxxxx:你的密码@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

建议：

- 优先用 Supabase 推荐的 pooler 连接串
- 复制后先保存到一个临时文档，后面 Render 要用

## 第 3 步：创建 Cloudflare R2

### 1. 创建 Bucket

1. 打开 `https://dash.cloudflare.com`
2. 登录
3. 左侧找到 `R2`
4. 点击 `Create bucket`
5. 输入 Bucket 名称，例如 `training-course-files`
6. 点击创建

这个 Bucket 名称就是后面要填的 `R2_BUCKET`。

### 2. 创建 R2 API Key

1. 进入 `R2`
2. 找到 `Manage R2 API tokens`
3. 点击 `Create API token`
4. 给这个 token 取一个名字
5. 权限选择可读写
6. 创建完成后复制下面两项：

- `Access Key ID`
- `Secret Access Key`

### 3. 记录 4 个关键值

你后面需要这 4 个值：

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

获取位置：

- `R2_BUCKET`
  就是你刚才创建的 Bucket 名称
- `R2_ACCOUNT_ID`
  Cloudflare 账户页面或 R2 页面都能看到
- `R2_ACCESS_KEY_ID`
  来自你刚生成的 API token
- `R2_SECRET_ACCESS_KEY`
  来自你刚生成的 API token

注意：

- `Secret Access Key` 丢了通常只能重新生成
- Bucket 名称一个字符都不能错

## 第 4 步：部署到 Render

### 1. 创建服务

1. 打开 `https://render.com`
2. 登录
3. 点击 `New +`
4. 选择 `Blueprint`
5. 授权 Render 访问你的 GitHub
6. 选择刚才那个仓库
7. Render 会自动读取项目里的 `render.yaml`
8. 点击继续创建

### 2. 填写环境变量

创建完服务后，打开该服务页面，进入 `Environment`，把下面这些变量补齐。

| 变量名 | 应填写的值 |
| --- | --- |
| `DATABASE_URL` | 你在 Supabase 复制的数据库连接串 |
| `DATABASE_SSL_MODE` | `require` |
| `STORAGE_PROVIDER` | `r2` |
| `APP_BASE_URL` | Render 分配给你的公网网址，例如 `https://xxx.onrender.com` |
| `R2_ACCOUNT_ID` | Cloudflare 的 Account ID |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 的 Secret Access Key |
| `R2_BUCKET` | 你的 Bucket 名称 |

Render 里具体点法：

1. 打开服务页面
2. 点击 `Environment`
3. 点击 `Add Environment Variable`
4. 一条一条录入上面的值
5. 全部保存

### 3. 手动触发第一次部署

1. 点击 `Manual Deploy`
2. 选择 `Deploy latest commit`
3. 等待 Render 构建

你通常会看到这些阶段：

1. `Cloning repository`
2. `Installing dependencies`
3. `Starting service`
4. `Health check`

只要最后服务变成 `Live`，说明第一次部署成功。

## 第 5 步：首次上线后验证

拿到 Render 公网地址后，按下面顺序检查。

### 1. 检查网页登录

1. 打开 Render 给你的网址
2. 看到登录页，说明站点已打开
3. 用管理员账号登录

### 2. 检查管理员建用户

1. 在管理员页添加一个用户名，例如 `test001`
2. 记住默认密码：`test001123`
3. 退出管理员
4. 用 `test001 / test001123` 登录

如果能成功登录，说明：

- 用户已写入数据库
- 密码生成逻辑正常
- 登录鉴权正常

### 3. 检查课件上传

1. 管理员重新登录
2. 上传一个课件
3. 去学员端预览课件

如果成功，说明：

- 数据库里 `resources` 已写入
- 文件已进入 R2
- 预览接口正常

### 4. 检查作业提交

1. 切到学员账号
2. 提交一份作业
3. 切回管理员账号
4. 检查该课节下是否看到提交记录

如果成功，说明：

- `submissions` 表正常
- 学员侧提交逻辑正常
- 管理员侧查询正常

### 5. 去后台再确认一次

你还可以顺手去 2 个地方人工确认：

1. Supabase
   查看 `users`、`resources`、`submissions` 表是否新增记录
2. Cloudflare R2
   查看 Bucket 中是否真的出现新文件

## 第 6 步：以后如何更新

以后每次你要更新页面或功能，只做这几步：

```bash
git add .
git commit -m "update"
git push
```

然后：

1. Render 会自动拉取 GitHub 最新代码
2. 自动重新部署
3. 你刷新页面就能看到新版本

## 第 7 步：如果 Render 没自动更新怎么办

1. 打开 Render 服务页面
2. 进入 `Events`
3. 检查最新一次 GitHub push 是否被识别
4. 如果没有，点击 `Manual Deploy -> Deploy latest commit`
5. 如果部署失败，进入 `Logs` 看报错

## 第 8 步：常见问题排查

### 1. 打不开网站

优先检查：

- Render 服务是否 `Live`
- `Logs` 里是否报数据库连接错误
- `DATABASE_URL` 是否漏填

### 2. 管理员添加的用户无法登录

优先检查：

- 数据库里 `users` 表是否真的有这条用户
- 默认密码是否按 `用户名+123`
- 是否部署的是最新代码

### 3. 课件上传后没保存

优先检查：

- `STORAGE_PROVIDER` 是否填成了 `r2`
- `R2_BUCKET` 是否正确
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 是否正确

### 4. 数据库连不上

优先检查：

- `DATABASE_URL` 是否完整
- 数据库密码是否替换正确
- `DATABASE_SSL_MODE` 是否是 `require`

### 5. 预览有问题

优先检查：

- 文件是否真的已经上传到 R2
- 数据库里 `resources.file_path` 是否有值
- 该文件类型是否属于当前支持预览的类型

## 配置项说明

`.env`、Render 环境变量、`config/local-config.json` 都支持这些配置：

- `PORT`
- `SESSION_DAYS`
- `DATABASE_URL`
- `DATABASE_SSL_MODE`
- `DATABASE_FILE`
- `STORAGE_PROVIDER`
- `STORAGE_DIR`
- `APP_BASE_URL`
- `COURSE_TITLE`
- `COURSE_SUBTITLE`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`

## 项目目录

- `backend/`：数据库、鉴权、文件存储
- `deploy/`：数据库初始化 SQL
- `frontend/`：静态页面和服务入口
- `runtime/`：本地运行期文件

## 当前上线方式的边界

这套方案适合现在这个阶段，但你需要知道边界：

1. 适合课程平台一期上线
2. 适合人数不大、以内部培训和分享为主
3. 适合你通过 GitHub 持续热更新
4. 后面如果用户量明显变大，再考虑拆前后端和加对象存储优化
