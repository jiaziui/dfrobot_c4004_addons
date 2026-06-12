# Reference
工程参考：01_Reference\everything-presence-addons\everything-presence-mmwave-configurator

# APP开发需求描述
1. 在自己add-ons 中，我希望设备数据和设备对应的传感能存储起来。所以在此之前我要完成设备扫描，当我在前端切换界面时，数据能从数据存储的地方拿出来，参考工程everything-presence-mmwave-configurator的原理：
需要实现的工程路径：05_Software\home_assistant\dfrobot_c4004_addons\dfrobot_c4004_app
    前端：dfrobot_c4004_app\frontend
    后端：dfrobot_c4004_app\backend

2.另外除了后端测需要弄通，前端对应位置也需要同时更改，如何前端没有合适的接口界面，你可以适当的更新，如果没有很重要的显示内容，你也可以适当的改前端代码

3.保证系统能在HA中正常运行起来



在前端左边的导航栏中添加设备部署导航栏；
 - 需要一个可调坐标系（这个坐标系尽可能的大，只要不占用导航栏，整屏可以铺满，其它组件放在整个坐标系之上）；能够放大和缩小；
 - 要求可以绘制线条（墙），绘制方法参考：01_Reference\everything-presence-addons\everything-presence-mmwave-configurator中的rome builder中绘制房间的方式；
 - 可部署我们绑定的设备，设备可以托动，部署在任意地方；
 - 设备都都以wifi探测图案呈现，同时控制探测角度；




