# UniFi API 与 LuCI 接入分析

## 调研目标

在设计 LuCI 集成前，需要回答两个问题：UniFi Network 对本地控制器提供哪些可用接口，哪些需求只能通过较旧的 Network API 满足；LuCI 的状态概览和设置页分别采用什么扩展模式，以及它们的权限如何由 rpcd ACL 控制。

本分析以 UniFi Network 官方开发者文档、OpenWrt LuCI 示例应用和目标 ImmortalWrt SDK 中的 LuCI 源码为依据。官方 API 文档会随 Network 版本更新；这里引用目前已核对的 v11.0.97 文档作为 API 能力基线，不将它当作目标控制器版本或兼容性证明。旧版 `/proxy/network/api/s/...` 接口的覆盖范围和兼容性仍需按控制器版本实测。

## UniFi API 调研

### API 形态

官方 [UniFi Network API v11.0.97 文档](https://developer.ui.com/network/v11.0.97/gettingstarted)列出站点、已采用设备、设备详情及最新统计、客户端详情及动作、Networks 和 Wi-Fi Broadcasts 等资源。请求使用 `X-API-Key`；已核对的 Networks 和 Wi-Fi Broadcasts 列表端点采用 `offset`/`limit`，响应包含 `data`、`count`、`limit`、`offset` 和 `totalCount`。本地控制器的 API 经 Network 代理路径访问；官方也提供云连接器代理路径，二者的主机和认证适用场景不同。

因此，Integration API 已有覆盖本项目主体数据的正式资源，不应再笼统地写成“是否提供设备统计/无线配置尚未确认”。需要继续区分的是：官方端点是否暴露本界面依赖的每个具体统计字段、Wi-Fi Broadcasts 是否包含所需安全配置或口令、设备/客户端动作支持的具体 action，以及是否存在固件检查/升级的正式动作。当前实现仍从旧版 API 读取设备负载、客户端链路指标和 WLAN 配置，并用旧版命令执行客户端重连与固件升级；这属于实现现状，不等于 Integration API 缺少这些能力。

### 能力与接口候选

| 界面需求 | Integration API 候选 | 旧版 Network API 候选 | 调研判断 |
| --- | --- | --- | --- |
| 站点选择 | `GET /proxy/network/integration/v1/sites` | `GET /proxy/network/api/self/sites` | Integration API 用于站点 ID；旧版动作需要站点名时，需将其 `external_id` 映射到旧版站点记录 |
| 设备列表、详情与统计 | `GET /proxy/network/integration/v1/sites/{siteId}/devices`；官方另列设备详情与最新统计资源 | `GET /proxy/network/api/s/{site}/stat/device` | 2026-11-04 路由实测返回设备基础字段；旧版接口返回 CPU、内存、负载、MAC 和 uptime 字段，与当前投影相符。只验证了第一页，未验证多页和超大响应 |
| 客户端列表与详情 | `GET /proxy/network/integration/v1/sites/{siteId}/clients`；官方另列客户端详情和客户端动作 | `GET /proxy/network/api/s/{site}/stat/sta` | 路由实测返回客户端基础字段；旧版接口返回无线制式、信号、速率、交换机和端口字段，与当前投影相符。重连 `kick-sta` 动作及权限没有执行验证 |
| WLAN 配置 | `GET /proxy/network/integration/v1/sites/{siteId}/wifi/broadcasts`（官方文档确认 Wi-Fi Broadcasts 资源） | `GET /proxy/network/api/s/{site}/rest/wlanconf` | 路由实测旧版接口返回 SSID、安全模式、频段及 `hasPassword` 等字段；没有读取明文密码。Integration API 的完整安全字段覆盖、口令读取和权限边界仍需验证 |
| 重启设备 | `POST /proxy/network/integration/v1/sites/{siteId}/devices/{deviceId}/actions` | 旧版命令也可能提供相关动作 | 官方设备动作资源和当前实现路径已确认；`RESTART` 的目标版本支持及控制器授权结果尚未实测 |
| 踢除 Wi-Fi 客户端 | 官方列有客户端动作资源；具体 action 名称需核对 | `POST /proxy/network/api/s/{site}/cmd/stamgr`，`{"cmd":"kick-sta","mac":"..."}` | 当前实现采用旧版命令。目标版本的官方 action 与权限未验证；旧版调用前应确认 MAC 属于当前无线客户端 |
| 检查与升级固件 | 官方设备详情/统计资源存在，但此次文档核对没有确认固件升级动作 | `POST .../cmd/productinfo`、`POST .../cmd/devmgr/upgrade` | 当前实现先用 Integration API 检查在线和可升级状态，再调用旧版升级命令。旧版响应及固件升级流程仍需目标控制器验证 |

表中的旧版路径来自当前实现，不代表 UniFi 为所有 Network 版本提供稳定的公开兼容承诺。设备/客户端统计、Wi-Fi Broadcasts 和动作 API 的资源存在性有官方文档依据；具体字段、动作类型、权限和旧版接口兼容性仍不能仅凭资源目录推定。

### API 设计约束

- 官方文档确认 API Key 通过 `X-API-Key` 请求头发送；本项目后端从 UCI 读取 key，未将其放进浏览器请求。目标路由上的现有 key 已成功读取站点、设备、客户端及旧版统计/WLAN 数据，但认证身份接口报告 `is_owner=true`、`is_super=true`，因此这次实测不能证明只读 Key 的权限边界。
- 官方文档确认已核对的 Integration API 列表接口使用 `limit`/`offset` 并返回 `totalCount`；目标路由首屏设备/客户端响应已成功解析。本项目设备/客户端请求按此参数分页，但当前记录数未超过单页上限，目标控制器多页边界和排序稳定性仍需验证。旧版 `/stat/sta` 是整批统计响应，不能假定支持同样分页。
- 仪表板只需要完整设备/客户端列表和少量派生统计。服务端字段投影可减少浏览器收到的敏感配置；SSID 密码应在用户显式请求时单独读取。
- 控制器可能使用内部 CA 或自签名证书。安全默认应为证书校验开启；IP 地址连接但证书使用 DNS 名称时，需要分别处理 TCP 目标、TLS SNI、证书校验名称和 HTTP Host。
- API 响应形状和端点可用性随 Network 应用版本变化。超时、HTTP 错误、非 JSON 响应、空响应和部分响应都应与“无设备/无站点”区分。

## OpenWrt LuCI 写法调研

### 状态概览扩展

LuCI `luci-mod-status` 会发现并加载 `view/status/include/*.js`，状态区块采用 `baseclass.extend({ title, load, render })`。`load()` 返回 Promise，`render()` 将结果构造成 DOM；全局状态页面负责周期性调用。目标 SDK 的 `view/status/include/60_wifi.js` 是本机无线状态与动作的可读参考。网络 API 请求应放在 `load()` 或用户动作处理器中，DOM 使用 LuCI 的 `E()` 创建。

### 设置页与配置

LuCI 表单页采用 `view.extend()`、`form.Map` 和具名 UCI section；选项通过 `form.Value`、`form.ListValue`、`form.Flag` 定义默认值、必填性和校验。表单写入 UCI 的能力由会话 ACL 授权，不由页面是否隐藏某个按钮决定。

### 后端调用和 ACL

前端可用 `fs.exec_direct()` 调用 ACL 明确允许执行的固定脚本，参数作为 argv 传入。脚本负责在 root 上下文中读取配置、验证参数并调用 curl/jq。只读与写权限应分别映射到 rpcd ACL：状态脚本归只读权限；保存凭据、读取敏感 Wi-Fi 信息及设备管理动作需要管理权限。ACL 授权对象是可调用的文件/接口，因此不能把脚本参数校验留给浏览器。

OpenWrt 的 [luci-app-example 文档](https://github.com/openwrt/luci/blob/master/applications/luci-app-example/README.md)说明了 `form.Map`、状态页 `load()`/`render()`、UCI defaults 和 ACL 的基础模式。实际函数和打包行为还应以目标 SDK 的 LuCI 版本为准；本项目目标 SDK 路径记录在仓库构建环境中，相关参考实现位于 `feeds/luci/modules/luci-mod-status`。

## 初步方案与仍待目标环境确认

较合适的组合是 LuCI 状态 include 展示只读数据、独立设置 view 管理 UCI 配置、固定后端脚本封装控制器通信；主体查询优先使用 Integration API，只有缺少字段或动作时才使用旧版 Network API。这样能保留官方接口作为基础，同时将旧接口依赖限定在可识别的功能边界内。

2026-11-04 已通过目标 BPI-R4 路由实测：安装 `luci-app-unifi-network` 与简体中文翻译 `1.0.0-r9`；原有 `/etc/config/unifi` 校验值保持不变，APK 将新默认配置保存在 `/etc/config/unifi.apk-new`。路由配置启用了 TLS 证书校验并设置了 SNI，未配置公钥 pin；通过包内 helper 的实际 HTTPS 请求成功访问控制器。

认证后的只读请求得到 UniFi Network `10.6.109`。Integration API 返回 1 个站点、2 台设备和 13 个客户端；设备、客户端列表字段符合当前投影。旧版接口也成功返回设备统计、客户端链路统计和 2 个 WLAN 项，实际字段已记录在 `docs/validation.md`。`api/self` 返回的认证身份标志为 owner/super，因此不能将现有 key 当作只读 Key 的权限验证；本次也只查了第一页，未验证多页边界。

路由测试确认了 API 可达性、TLS 校验路径、认证后的响应形状和当前身份信息。剩余待确认项是：使用真正的只读 Key 核对资源权限；使用不同 LuCI 会话实测只读/管理 ACL；验证多页数据、超大旧版响应及 WLAN 密码读取边界。真实设备重启、客户端重连和固件升级仍需隔离 AP/测试客户端；本次没有触发任何写操作。
