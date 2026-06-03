<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
## Remote work safety rules

When the user is operating remotely from mobile:

- Do not run destructive commands such as taskkill, Remove-Item, rmdir, del, git reset, git clean unless explicitly approved.
- Do not modify package.json or package-lock.json unless explicitly approved.
- Do not modify data/danish-products.ts or scripts/* unless the task is specifically about scraping or data conversion.
- Do not commit automatically unless explicitly approved.
- Always run npm.cmd run build after code changes when possible.
- If build fails due to Windows .next trace EPERM errors, report the error and do not delete .next unless explicitly approved.
- End every task with:
  【任务结果】
  【修改文件】
  【Build 结果】
  【git status --short】
  【需要人工验收的页面】
