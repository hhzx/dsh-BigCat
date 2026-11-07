# dsh-BigCat

点击已经发出的用户消息，在原气泡里改写并重新发送。窗口右上角的图钉用来钉住或取消 DSH Desktop 置顶。

## 安装

在 DSH 的插件页添加这个 Git 地址：

```text
https://github.com/hhzx/dsh-BigCat.git
```

或在对应 profile 下执行：

```sh
dsh plugin add https://github.com/hhzx/dsh-BigCat.git
```

装好后重新加载页面。服务端改动需要重启 DSH Desktop。

## 功能

- 点击已发送的用户气泡，气泡本身变成输入框。Enter 发送，Shift+Enter 换行，Esc 取消。时间戳留在气泡外面。
- 重新发送会从这条消息之前分叉出会话，原会话保留。DSH 不能在原地改写已经写下的历史。
- 右上角图钉切换窗口是否保持在最前。未置顶是斜放的空心图钉，置顶是竖直的绿色实心图钉。

## 环境

置顶使用 Windows API，只在 Windows 上的 DSH Desktop 生效。重新发送需要本机可用的 Python，用来在会话记录里定位这条消息。
