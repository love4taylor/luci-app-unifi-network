# 调研验证记录

本文区分文档/源码调研所得结论与必须依赖目标设备的实测项。运行本地单元测试只能证明数据转换逻辑，不能证明控制器 API 兼容性或 LuCI 会话 ACL 行为。

## 已核对的资料

| 项目 | 证据 | 可以确认 | 不能据此确认 |
| --- | --- | --- | --- |
| UniFi Network API | [官方 Network API v11.0.97 文档](https://developer.ui.com/network/v11.0.97/gettingstarted) | 官方文档列有站点、已采用设备/详情/最新统计、客户端/详情/动作、Wi-Fi Broadcasts；已核对的分页列表端点使用 `offset`/`limit` 并返回 `totalCount`；示例使用 `X-API-Key` | 目标控制器是否提供同一版本和字段；旧版 `/proxy/network/api/s/...` 接口兼容性；具体动作类型和 API Key 权限 |
| 目标控制器网络/TLS | 2026-11-04 从目标 BPI-R4 路由执行带认证与不带认证的只读请求；检查 UCI TLS 设置 | 路由启用了证书校验（`verify_tls=1`）、配置了 SNI、未配置 pin；不带 key 的站点请求返回 HTTP 401；带当前 key 的 API 请求成功，应用信息返回 Network `10.6.109` | 当前 key 对应 owner/super 身份，不是只读身份；错误 SNI/pin、只读 Key 授权范围和写操作未验证 |
| LuCI 应用模式 | [OpenWrt luci-app-example](https://github.com/openwrt/luci/blob/master/applications/luci-app-example/README.md) | LuCI 支持 form.Map/UCI 表单、状态 view 的 `load()`/`render()` 及 rpcd ACL 声明 | 目标 SDK 分支的细节是否与上游 master 完全一致 |
| 目标 SDK 状态页 | ImmortalWrt SDK 25.12.2 中 `feeds/luci/modules/luci-mod-status/htdocs/luci-static/resources/view/status/index.js` 与 `view/status/include/60_wifi.js` | 已核对：status index 扫描并加载 include，周期执行 `load()`，再调用 `render()`；无线区块用 `baseclass.extend()` 和 LuCI RPC/UBus | 本插件打包安装后的 ACL、缓存和刷新行为 |
| 本地实现路径 | `root/usr/libexec/unifi-network/unifi-common.sh`、`unifi-status-details`、`unifi-status`、`unifi-restart`、`unifi-reconnect`、`unifi-device-update` | 已核对实际请求路径和字段投影：Integration API 负责站点/设备/客户端基础数据及重启，旧版 API 负责额外统计、WLAN、重连和升级 | 控制器是否仍返回预期的旧版字段、具体 action/权限结果 |
| 本地投影测试 | `node --test tests/*.test.js` | WPA 安全模式投影、密码字段排除及 1000 个客户端的 jq 汇总用例 | 控制器响应结构、真实 API 权限、设备写操作及浏览器端完整集成 |
| 目标路由安装 | 目标 BPI-R4 上安装 app 与简体中文翻译 `1.0.0-r9`，检查已安装文件和 rpcd ACL JSON | 新 `/usr/libexec/unifi-network/` helper 存在且可执行，旧 `/usr/libexec/luci/` helper 路径已移除；只读 ACL 与管理 ACL 已安装；原 `/etc/config/unifi` 未变化，新默认配置保存在 `.apk-new` | 未用不同 LuCI 用户会话验证运行时授权，也未完成浏览器缓存/页面交互验证 |

## 目标环境验证矩阵

| 验证对象 | 操作 | 通过条件 | 状态 |
| --- | --- | --- | --- |
| 控制器版本与认证 API | 从路由请求 `GET /proxy/network/integration/v1/info`、`sites`、`devices`、`clients`，并读取旧版统计/WLAN 详情 | 版本为 `10.6.109`；站点、设备、客户端和补充详情请求均成功，返回字段见下节 | 已用当前 owner/super key 验证成功响应；真正只读 Key 权限范围仍待验证 |
| 认证权限 | 从路由读取 `api/self` 身份摘要并检查已安装 ACL；使用只读 API Key 和不同 LuCI 会话复测 | 只读 Key 能读取预期资源但不能执行管理操作；LuCI 只读/管理会话分别符合 ACL | 当前 key 报告 `is_owner=true`、`is_super=true`，并非只读身份；ACL 文件已安装，运行时会话授权待验证 |
| Integration API 翻页 | 用多个 offset 查询设备/客户端并比较 `totalCount` 和记录 ID | 无重复、无遗漏；最后一页及空列表行为符合前端结束条件 | 当前只查询 offset 0，数据均小于单页上限；目标控制器多页行为未测，分页参数规范有官方文档依据 |
| 旧版统计接口规模 | 对照控制器客户端总数与 `/stat/sta` 完整响应，并用大列表覆盖本地聚合 | 返回记录完整；响应体大小低于 curl 限制；聚合输出有效 JSON | 路由已返回 13 个客户端及统计字段；大响应体/限制仍未实测，本地 1000 条模拟用例通过 |
| WLAN 敏感字段 | 普通概览轮询后检查浏览器响应；显式点击显示密码后单独检查授权行为 | 概览不带明文密码；密码读取受管理 ACL 保护 | 路由已返回 2 个 WLAN 项及安全属性字段；未读取明文密码，浏览器响应和用户 ACL 边界待验证 |
| TLS / SNI | 在目标路由器用当前 UCI 设置访问控制器；另测错误 SNI、pin 匹配/不匹配 | 当前证书校验成功；错误名称及不匹配 pin 失败；TCP 仍连配置的目标地址 | 当前路由 `verify_tls=1`、SNI 已配置且实际 API 请求成功；未配置 pin，负向测试未做 |
| LuCI 刷新与页面集成 | 安装 r9 构建产物，观察首次加载、周期刷新、控制器离线、切换站点和不同 ACL 会话 | 区块独立显示错误；刷新不产生重复请求；只读与管理会话行为符合 ACL | r9 已安装，helper 与 ACL 文件已检查；浏览器页面和不同用户会话未实测 |
| 写操作 | 在隔离测试设备上确认重启、踢除客户端、检查并升级固件 | 目标、请求内容和控制器返回状态正确；设备离线/不可升级时请求被拒绝 | 未执行；需要隔离 AP 和测试客户端 |

## 2026-11-04 目标路由实测详情

目标路由上的现有 API Key 成功完成只读请求。控制器应用信息接口返回 `applicationVersion=10.6.109`；站点、设备、客户端端点分别返回 1、2、13 条记录。以下是实际响应中首条记录的字段集合，不包含记录值：

| 资源 | 字段 |
| --- | --- |
| 站点 | `id`, `internalReference`, `name` |
| 设备 | `features`, `firmwareUpdatable`, `firmwareVersion`, `id`, `interfaces`, `ipAddress`, `macAddress`, `model`, `name`, `state`, `supported` |
| 客户端 | `access`, `connectedAt`, `id`, `macAddress`, `name`, `type`, `uplinkDeviceId` |
| 旧版设备统计 | `cpuUtilizationPct`, `loadAverage`, `mac`, `memoryUtilizationPct`, `uptimeSec` |
| 旧版客户端统计 | `isWired`, `mac`, `radioProtocol`, `rxRateKbps`, `signalDbm`, `switchMac`, `switchPort`, `txRateKbps`, `wiredRateMbps` |
| WLAN | `bands`, `enabled`, `hasPassword`, `hidden`, `id`, `name`, `security`, `wpa3Support`, `wpa3Transition`, `wpaMode` |

旧版统计接口返回 2 台设备、13 个客户端，WLAN 接口返回 2 个项目。路由当前 `verify_tls=1`、SNI 已配置、pin 未配置；这些 HTTPS 请求成功。当前 API 身份摘要为 `is_owner=true`、`is_super=true`，因此只证明现有 key 可以读取这些响应，不能作为只读 key 的权限证据。

安装的 rpcd ACL 分为 `luci-app-unifi-network` 只读组与 `luci-app-unifi-network-admin` 管理组。前者只允许调用状态/详情 helper；后者额外允许设置、Wi-Fi 密码读取、重启、重连和固件升级 helper。这里只检查了路由上的 ACL 声明，没有使用不同 LuCI 登录会话验证最终授权。此次没有触发任何写操作。

## 当前本地验证

```sh
node --test tests/*.test.js
```

当前测试覆盖 8 个用例。它们是实现级回归测试，不是上述控制器兼容性或设备端验证的替代品。还需在目标 ImmortalWrt 上使用只读用户与管理用户的实际 LuCI 会话验证 rpcd ACL，避免仅凭 ACL JSON 文件内容推断运行时授权结果。
