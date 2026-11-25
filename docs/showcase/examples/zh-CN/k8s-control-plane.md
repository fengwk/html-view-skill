---
title: Kubernetes 控制平面与节点架构
---

# Kubernetes 控制平面与节点架构

> 本文是对 Kubernetes 官方文档 [Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/) 的阅读整理，供架构评审时对照组件职责与部署变体。概念与职责以官方文档为准；本文不新增规范，也不包含虚构规模或性能数字。
>
> 来源：Kubernetes 官方文档（[kubernetes.io](https://kubernetes.io/docs/concepts/architecture/)），文档许可为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，作者 The Kubernetes Authors。项目源代码为 Apache-2.0。抓取参考的上游页面日期以仓库 `website` 当时公开内容为准。

## 范围与阅读目的

一套 Kubernetes 集群由**控制平面**和一组运行容器化工作负载的**工作节点（Node）**组成。控制平面管理节点与 Pod；生产环境中控制平面通常跨多台机器部署，集群也通常有多个节点，以提供容错。

| 范围 | 本文说明 | 不在本文展开 |
|---|---|---|
| 控制平面 | kube-apiserver、etcd、kube-scheduler、kube-controller-manager、可选的 cloud-controller-manager | 具体高可用拓扑、证书轮转与升级手册 |
| 节点 | kubelet、可选的 kube-proxy、容器运行时 | 各运行时的安装步骤与 CRI 细节 |
| 附加组件 | DNS、CNI、监控与日志等集群级功能的位置 | 某一具体插件的配置参考 |
| 部署变体 | 传统进程、静态 Pod、自托管、托管控制平面 | 云厂商产品对照表 |

## 组件分层

控制平面做集群范围的决策（例如调度），并响应集群事件（例如 Deployment 的副本未满足时创建 Pod）。组件可以运行在集群中的任意机器上；常见安装工具会把控制平面集中在专用机器，并避免在其上运行用户容器。工作节点托管应用 Pod，并提供运行时环境。

```layers
---
title: 控制平面通过 API 与集群状态管理节点上的工作负载
---
- 控制平面 | 全局决策、状态与控制循环
  - apiserver: API, 鉴权校验
  - etcd {db}: 集群状态
  - scheduler: 为 Pod 选节点
  - controller-manager: 控制循环
- 工作节点 | 运行 Pod，维持节点环境
  - kubelet: 按规约管理容器
  - kube-proxy {ext}: Service 代理
  - 容器运行时: 镜像拉取与运行
```

节点与控制平面之间的在线关系、以及默认调度器的选点逻辑，见官方文档的 [节点通信](https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/) 与 [kube-scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)。

## 控制平面职责

| 组件 | 职责 | 备注 |
|---|---|---|
| kube-apiserver | 集群的前端 API。校验并处理 REST 请求，是其余组件读写集群状态的唯一正规入口 | 可水平扩展多个实例 |
| etcd | 保存集群的后备状态，一致的键值存储 | 以 etcd 官方文档为运维依据 |
| kube-scheduler | 监视尚未绑定节点的新 Pod，根据资源、亲和性、污点与约束选择节点 | 可用自定义调度器并行或替换 |
| kube-controller-manager | 将多条控制循环打成一个进程：例如 Node、Job、EndpointSlice、ServiceAccount 等控制器 | 官方强调这不是完整清单 |
| cloud-controller-manager | 只运行与云厂商相关的循环，例如节点是否已在云上删除、路由、负载均衡 | 自建机房或本地学习环境通常不运行该组件 |

控制平面组件在逻辑上彼此独立，安装形态却可以组合：同一台机器上的多个进程、kubeadm 常见的静态 Pod，或由 Deployment / StatefulSet 管理的自托管控制平面。托管 Kubernetes 服务则往往把控制平面作为产品的一部分代为运营。

## 节点职责

| 组件 | 职责 | 备注 |
|---|---|---|
| kubelet | 在节点上按 Pod 规约确保容器处于运行状态，并向控制平面汇报 | 每个节点都需要 |
| kube-proxy | 在节点上实现 Service 的部分网络行为 | 若网络插件已等价实现转发，可以不在节点上运行 kube-proxy |
| 容器运行时 | 负责拉取镜像、创建并运行容器 | 需实现 Kubernetes 的容器运行时接口 |

官方架构图将「每个节点运行 kube-proxy」作为参考示例，同时明确：具体组件分布随集群方案变化；使用自行实现 Service 代理的网络插件时，节点不必再跑 kube-proxy。

## 附加组件与扩展点

附加组件用 Kubernetes 资源（如 DaemonSet、Deployment）提供集群级能力，其命名空间资源通常放在 `kube-system`。官方建议每个集群都应有[集群 DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)，因为大量示例依赖它。其他常见附加能力包括 Dashboard、容器资源监控、集群级日志，以及实现 CNI 规范、为 Pod 分配地址并打通集群内通信的网络插件。

架构允许显著定制：自定义调度器可与默认调度器并存或替换它；API 可通过 CRD 与 API Aggregation 扩展；云厂商可通过 cloud-controller-manager 深度集成。

## 部署时需要记住的变体

- **控制平面放置**：小型或开发集群可能把控制平面与用户负载放在同一批节点；较大的生产集群通常为控制平面准备专用节点，并与用户工作负载隔离。
- **管理工具**：kubeadm、kops、Kubespray 等工具对组件布局和管理方式并不相同，选型时要对照其默认拓扑，而不是假定只有一种标准摆放。
- **本文未覆盖的运维主题**：证书与审计、升级与回滚、etcd 备份、网络策略细则，以及具体云厂商的托管控制平面契约，都应回到对应官方文档或厂商文档，而不是从本整理推断 SLA。

## 依据与许可

正文依据 Kubernetes 官方文档 [Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/) 整理，许可为 Creative Commons Attribution 4.0。结构图层是按该文档中的组件关系重绘的说明图，不是官方原图的复制件。官方原图见同一页面的 “Kubernetes cluster components”。如需部署或排障，以当时版本的官方文档为准。
