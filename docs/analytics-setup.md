# 烟斗派网站流量统计

访问地址：`https://yandoubuy.cn/admin/analytics`。统计页没有加入公开导航，数据由服务端读取，未登录时跳转到密码登录页。仅隐藏链接不构成访问控制，必须配置下列密钥。

## 上线配置

1. 在 Ubuntu 服务器上为运行 Next.js 的服务账户准备一个持久化且可写的私有目录，例如 `/var/lib/yandoubuy-analytics`。设置服务进程的 `ANALYTICS_DB_PATH=/var/lib/yandoubuy-analytics/visits.sqlite`。使用 Node.js 24 运行；SQLite 数据库文件首次访问时自动创建。把数据库文件及同目录的 `-wal`、`-shm` 文件纳入服务器备份，不要将目录放在 Git 仓库或 Next.js 构建目录里。
2. 管理员账号固定为 `admin`。把用户提供的管理员密码配置为服务器环境变量 `ANALYTICS_ADMIN_PASSWORD`（至少 8 个字符），切勿写进代码或提交到 Git。
3. 设置 `ANALYTICS_SESSION_SECRET` 为独立的随机密钥，至少 32 个字符。更换该密钥会使现有登录状态失效。可用 Node 生成：`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`。
4. 部署后打开 `/admin/analytics`，确认跳转登录；登录后刷新页面检查统计；退出后确认无法读取页面。不要把密钥提交到 Git。

当前线上站点由 Ubuntu/Nginx 转发 Next.js。上述三个变量必须设置在运行 Next.js 的服务进程中，而不是只设置在 Nginx。更新代码前先确认进程管理方式及服务目录，设置变量后重启对应 Next.js 服务，保留已有配置和商品数据；最后在正式域名上验证未登录跳转、登录、退出和新访问计数。数据库目录只授予服务账户读写权限。

也支持 Upstash Redis：如果不能使用服务器的持久化磁盘，可不设置 `ANALYTICS_DB_PATH`，改用服务端环境变量 `ANALYTICS_REDIS_REST_URL` 与 `ANALYTICS_REDIS_REST_TOKEN`；令牌不要使用 `NEXT_PUBLIC_` 前缀。两种存储互不自动迁移，不要在已有数据后随意切换。

## 口径

- 每次成功发送页面访问请求算一次浏览（PV）；单页应用导航同样计入。累计、近 7 天、近 30 天均从配置启用后开始，没有历史回填。
- 服务端设置一年有效的随机浏览器标识；本机 SQLite 通过不可逆的浏览器标识散列精确去重。若改用 Redis，访客数由 HyperLogLog 近似去重。近 7/30 天跨天去重，因此每天访客数相加可能高于同期访客数。不同设备、清除 Cookie 后分别计算。
- 日期采用北京时间（UTC+8）；趋势展示最近 30 个自然日，含当日。热门页面显示累计前 10 个路径，不保存查询参数。
- 管理员登录期间的访问不计入；脚本未运行或被拦截的访问、爬虫等可能漏计；运行脚本的机器人或重复刷新可能计入。
- 不保存 IP 或页面查询参数。本机 SQLite 保存页面路径、北京时间日期和浏览器标识的散列，用于统计汇总；登录限流键由 IP 的 HMAC 生成，并定期清理。数据库数据目前不自动过期，应纳入常规备份。

若存储未配置或不可用，登录和采集会安全失败；统计页不会提供公开的后备数据。
