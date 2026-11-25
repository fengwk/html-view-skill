---
title: Kubernetes control plane and node architecture
---

# Kubernetes control plane and node architecture

> This note restates the official Kubernetes [Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/) document so a design review can check component responsibilities and deployment variants in one place. Duties follow the upstream docs. This page adds no new specification and invents no scale or performance numbers.
>
> Source: the official Kubernetes documentation on [kubernetes.io](https://kubernetes.io/docs/concepts/architecture/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), © The Kubernetes Authors. The Kubernetes project itself is Apache-2.0.

## Scope

A Kubernetes cluster is a **control plane** plus a set of worker machines, called **nodes**, that run containerized applications. The control plane manages the nodes and the Pods. In production, the control plane usually runs across multiple machines, and a cluster usually runs multiple nodes, for fault tolerance.

| Area | This note covers | Left to other docs |
|---|---|---|
| Control plane | kube-apiserver, etcd, kube-scheduler, kube-controller-manager, and the optional cloud-controller-manager | A concrete HA topology, certificate rotation, or an upgrade runbook |
| Nodes | kubelet, optional kube-proxy, and the container runtime | Install steps for a given runtime or CRI details |
| Addons | Where DNS, CNI, monitoring, and logging sit | Configuration reference for one plugin |
| Deployment variants | Traditional processes, static Pods, self-hosted, and managed control planes | A vendor-by-vendor product matrix |

## Component layers

The control plane makes cluster-wide decisions (for example, scheduling) and responds to cluster events (for example, starting a Pod when a Deployment’s replica count is not satisfied). Components can run on any machine in the cluster; setup tools often colocate the control plane on dedicated machines and keep user containers off those machines. Worker nodes host application Pods and provide the runtime.

```layers
---
title: The control plane manages node workloads through the API and cluster state
---
- Control plane | Decisions, state, and loops
  - apiserver: API, authn, admission
  - etcd {db}: Cluster state
  - scheduler: Binds Pods to nodes
  - controller-manager: Control loops
- Worker nodes | Run Pods, keep the node
  - kubelet: Runs Pod containers
  - kube-proxy {ext}: Service proxy
  - Container runtime: Pulls and runs images
```

Node-to-control-plane traffic and the default scheduler’s binding logic are documented in [control plane / node communication](https://kubernetes.io/docs/concepts/architecture/control-plane-node-communication/) and [kube-scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/).

## Control plane responsibilities

| Component | Role | Notes |
|---|---|---|
| kube-apiserver | Front end of the control plane. Validates and serves REST requests; the regular entry point other components use to read and write cluster state | Can be scaled horizontally |
| etcd | Backing store for cluster state; a consistent key-value store | Operate it from etcd’s own documentation |
| kube-scheduler | Watches for newly created Pods that have no node assigned, then picks a node from resources, affinity, taints, and other constraints | A custom scheduler can run alongside it or replace it |
| kube-controller-manager | Runs several control loops in one process, including Node, Job, EndpointSlice, and ServiceAccount controllers | The official list is not exhaustive |
| cloud-controller-manager | Runs only loops that depend on a cloud provider, such as checking whether a node was deleted in the cloud, routes, and load balancers | A bare-metal or local learning cluster typically does not run it |

The components are logically independent even when an installer packs them together: processes on one machine, static Pods as kubeadm often uses, or a self-hosted control plane managed with Deployments and StatefulSets. Managed Kubernetes services often operate the control plane as part of the product.

## Node responsibilities

| Component | Role | Notes |
|---|---|---|
| kubelet | Makes sure containers described by a Pod are running on the node, and reports back to the control plane | Required on every node |
| kube-proxy | Implements part of Service networking on the node | You can omit it when a network plugin already provides equivalent forwarding |
| Container runtime | Pulls images and runs containers | Must implement the Kubernetes container runtime interface |

The official architecture diagram shows kube-proxy on every node as a reference layout, and also states that the real distribution of components varies. When a network plugin implements Service proxying itself, nodes do not need kube-proxy.

## Addons and extension points

Addons use Kubernetes resources (DaemonSet, Deployment, and others) to implement cluster-level features. Namespaced addon objects usually live in `kube-system`. Official guidance is that every cluster should have [cluster DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/), because many examples depend on it. Other common addons include Dashboard, container resource monitoring, cluster-level logging, and a network plugin that implements CNI, assigns Pod IPs, and lets Pods reach each other.

The architecture is deliberately extensible: a custom scheduler can run beside or instead of the default one; the API can grow through CRDs and API Aggregation; cloud providers can integrate through cloud-controller-manager.

## Variants to keep in mind

- **Placement.** Smaller or development clusters may colocate the control plane with user workloads. Larger production clusters often dedicate nodes to the control plane and keep user workloads off them.
- **Cluster tooling.** kubeadm, kops, and Kubespray place and manage components differently. Compare the tool’s default topology instead of assuming a single standard layout.
- **Out of scope here.** Certificates and audit logs, upgrades, etcd backups, network-policy details, and the contract of a particular managed control plane belong in the versioned official docs or the vendor’s docs—not in inferences from this summary.

## Source and license

This text is adapted from the official Kubernetes [Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/) page, licensed under Creative Commons Attribution 4.0. The layer diagram is a redrawn explanation of the components described there, not a copy of the official figure. The official figure is “Kubernetes cluster components” on that page. For deployment or troubleshooting, use the official documentation for the Kubernetes version you run.
