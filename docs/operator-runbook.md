# 团队日常运行手册

本工具按单机本地团队使用。业务数据库、截图和 Edge 登录资料都在运行电脑上；同一项目实例的成员共用这些数据。

## 每天开始

1. 使用固定的 Windows 用户和项目目录启动服务：`npm start`。保持终端和电脑运行；网页可关闭。不要同时启动两个实例共用数据库或 `profiles/`。
2. 打开 <http://127.0.0.1:8790>，确认页面显示“本地运行”，检查平台账号是否仍可用，以及近期任务和到期时间。
3. 遇到登录或验证提示时，在任务栏打开对应账号的 Edge 窗口人工处理，再从页面继续任务。不要在等待恢复时手动提交同一问题。

## 创建运行与查看结论

1. 首次验收先选两个平台、两个问题，连续运行两次；逐条核对原网页、账号、问题、保存回答、引用和截图。
2. 日常运行后先打开“采集结果”，检查失败、未定位、重复归属、问题/账号错配、截图缺失和引用不完整提示。点击对应记录回到原文、截图与执行诊断。
3. 再看“分析报告”和“变化动态”。百分比要连同分子、分母、未知数和过滤范围一起读；显示“无法计算”表示没有可用分母。条件未知的变化只供查看原文。
4. 正文命中品牌名只是名称出现，不代表推荐、认可或排名。来源链接只表示页面保存的链接，不证明网页内容支持回答。不要将旧情感字段作为决策依据。
5. 严重异常逐条核对。每周每个平台随机核对 5 条正常结果；少于 5 条时全部抽查。平台页面或采集规则变化后，暂停日常解读，重新做小批量真实采集验收。

## 每日结束与备份

确认没有任务正在执行后，在项目根目录运行：

```powershell
npm run backup
```

默认备份写入 `backups/geo-时间戳/`，包含数据库和结果截图，不包含 `profiles/` 中的登录资料。确认新目录内有 `geo-monitor.db`，并在备份包含截图时抽开一张验证。升级代码前也先备份。备份应复制到与运行电脑不同的安全存储位置；仅留在同一磁盘不能防止磁盘故障。

## 恢复备份

先记下准备恢复的备份目录，并确认它来自正确项目和日期。停止 GEO 服务（终端按 `Ctrl+C`），关闭其他使用该数据库的进程。以下命令会保留当前数据库副本，并把当前 `results` 文件夹改名留存，再恢复备份；先替换 `$backup` 为实际备份目录：

```powershell
$backup = 'D:\Projects\geo-web-monitor\backups\geo-YYYY-MM-DDTHH-MM-SS-sssZ'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath 'data\geo-monitor.db' -Destination "data\geo-monitor.before-restore-$stamp.db"
if (Test-Path -LiteralPath 'results') {
  Move-Item -LiteralPath 'results' -Destination "results.before-restore-$stamp"
}
Copy-Item -LiteralPath (Join-Path $backup 'geo-monitor.db') -Destination 'data\geo-monitor.db'
if (Test-Path -LiteralPath (Join-Path $backup 'results')) {
  New-Item -ItemType Directory -Path 'results' | Out-Null
  Copy-Item -Path (Join-Path $backup 'results\*') -Destination 'results' -Recurse -Force
}
```

如果设置了 `GEO_DB_PATH` 或 `GEO_RESULTS_ROOT`，恢复到这些变量指向的位置；不要照抄默认路径。不要覆盖或复制 `profiles/`。重新启动后先登录检查账号，再核对运行列表、回答和截图。发现异常时停止使用恢复后的数据，保留刚才留存的旧目录并从另一份备份复查。

## 停机与错过的计划任务

关闭网页不会停止服务；关闭服务或让电脑休眠/关机则不会执行定时任务。服务重新启动后，已错过的周期按现有行为合并补跑一次，不会逐个补齐历史周期。每天开始时检查任务状态；不要把缺少的运行误读为零次品牌出现。

## 上线前验收

正式投入团队前必须通过自动测试、真实平台小规模验收、数据与截图可追溯检查及备份恢复演练。真实平台测试需由已登录账号产生两个平台、两个问题、两次运行的至少 8 条结果；自动模拟测试不能替代该检查。若账号不可用或平台限制导致测试无法完成，将工具保持在试运行状态，不用模拟结果宣称已通过真实验收。
