https://help.aliyun.com/zh/ecs/user-guide/workbench-overview/?spm=5176.12818093_47.console-base_help.dexternal.ee6916d0wgc9cj&scm=20140722.S_help%40%40%E6%96%87%E6%A1%A3%40%40108412.S_BB1%40bl%2BRQW%40ag0%2BBB2%40ag0%2Bos0.ID_108412-RL_Workbench-LOC_console~UND~help-OR_ser-PAR1_213e8bf817776220412067178d0713-V_4-P0_0-P1_0

Workbench是阿里云提供的在浏览器使用的远程连接工具，使用该工具，无需额外安装任何软件即可通过浏览器直接访问ECS实例。



\## \*\*什么是Workbench？\*\*



\### \*\*Workbench介绍\*\*



Workbench是阿里云提供的一款Web远程连接工具，该工具无需安装，直接在浏览器使用。使用该工具连接ECS实例流程如图所示。



!\[image](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/5009034671/CAEQURiBgICFjNOlmRkiIDUzYzA5ZjQ4ZGU5ZDQ2MWJiNWIxNjZkZGJhMmEzNzQ04757331\_20241113164106.974.svg)



\### \*\*Workbench的特点\*\*



\-   #### \*\*支持多种连接方式\*\*

&#x20;   

&#x20;   通过Workbench可以使用多种方式连接实例，如SSH（Linux常用）、RDP（Windows常用）、运维安全中心等。

&#x20;   

&#x20;   \*\*相关文档\*\*

&#x20;   

&#x20;   -   \[使用Workbench登录Linux实例](https://help.aliyun.com/zh/ecs/user-guide/connect-to-a-linux-instance-by-using-a-password-or-key)

&#x20;       

&#x20;   -   \[使用Workbench登录Windows实例](https://help.aliyun.com/zh/ecs/user-guide/connect-to-a-windows-instance-through-workbench)

&#x20;       



\-   #### \*\*支持通过公网或私网连接实例\*\*

&#x20;   

&#x20;   当您在使用Workbench通过SSH或RDP方式连接到实例时，可以选择通过私网或公网IP连接实例。

&#x20;   



\### \*\*Workbench更多功能\*\*



除了连接实例外，Workbench还支持以下功能。



\-   \*\*文件管理：\*\*支持可视化管理Linux实例中的文件，支持文件上传下载。请参见\[文件管理](https://help.aliyun.com/zh/ecs/user-guide/manage-files)。

&#x20;   

\-   \*\*AI Agent模式：\*\*在\*\*AI Agent模式\*\*下，可通过自然语言指令规划并执行Linux运维操作，简化软件安装、异常问题诊断等任务。请参见\[AI Agent模式](https://help.aliyun.com/zh/ecs/user-guide/workbench-ai-agent-mode)。

&#x20;   

\-   \*\*终端助手：\*\*帮助您生成运维中需要的脚本/命令。请参见\[终端助手](https://help.aliyun.com/zh/ecs/user-guide/intelligent-assistant)。

&#x20;   

\-   \*\*智能命令补全：\*\*当在命令行中输入命令时，它能够根据上下文实时预测并以列表形式展示后续可能使用的命令、参数或选项。请参见\[智能命令补全](https://help.aliyun.com/zh/ecs/user-guide/intelligent-command-completion)。

&#x20;   

\-   \*\*系统管理：\*\*可通过 Workbench 的系统管理功能，统一管理 Linux 实例的用户、登录日志和系统服务，实时监控系统运行状态。同时支持可视化地为 Java 应用添加堆分析、线程栈分析或性能分析等运维任务。请参见\[系统管理](https://help.aliyun.com/zh/ecs/user-guide/workbench-system-management)。

&#x20;   

\-   \*\*脚本库：\*\*允许将常用的命令或脚本片段保存在Workbench，并在任何通过Workbench连接的实例会话中一键调用执行。请参见\[脚本库](https://help.aliyun.com/zh/ecs/user-guide/workbench-script-library)。

&#x20;   

\-   \*\*录屏审计：\*\*录制终端用户在ECS实例内部的操作视频，以便管理员进行操作审计时查看终端用户的操作行为，为安全审计提供有效依据。请参见\[录屏审计](https://help.aliyun.com/zh/ecs/user-guide/screen-recording-audit)。

&#x20;   

\-   \*\*命令行审计：\*\*审查经过Workbench登录会话执行的历史命令是否符合安全标准，帮助您发现异常操作和风险事件，并记录具体的执行命令、执行命令时间等信息，以便进行后续分析和审计。请参见\[命令行审计](https://help.aliyun.com/zh/ecs/user-guide/command-audit)。

&#x20;   

\-   \*\*多屏终端：\*\*可以通过Workbench的多屏终端功能同时连接多台ECS实例，然后在多台实例中同时执行相同的命令。请参见\[多屏终端](https://help.aliyun.com/zh/ecs/user-guide/use-the-multi-terminal-feature)。

&#x20;   

\-   \*\*软件安装：\*\*可在Workbench中使用AI Agent或OOS预设软件包自动部署Docker、MySQL等软件。请参见\[软件安装](https://help.aliyun.com/zh/ecs/user-guide/workbench-software-installation)。

&#x20;   



\## \*\*Workbench基本使用流程\*\*



使用Workbench连接实例的流程如图所示。



!\[image](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/5009034671/CAEQURiBgMDen\_ulmRkiIGIwM2FiMzBlNTYzODQ4M2FhODIzYmU0MWZkMTdjMTMz4757331\_20241114103946.039.svg)



1\.  \*\*找到待连接的实例。\*\*

&#x20;   

2\.  \*\*打通Workbench与ECS实例之间的网络连接。\*\*

&#x20;   

&#x20;   这一步需要设置实例所在的安全组与实例内防火墙，需放行来自Workbench的入方向流量。

&#x20;   

3\.  \*\*使用Workbench连接实例。\*\*

&#x20;   

&#x20;   在控制台选择通过Workbench连接实例，输入用户名、密码、密钥对等信息。

&#x20;   

4\.  \*\*开通服务关联角色。\*\*

&#x20;   

&#x20;   如果您在使用Workbench连接实例时没有创建服务关联角色，系统会提示您授予Workbench访问ECS实例的权限，即开通服务关联角色。

&#x20;   

5\.  \*\*成功连接到实例，执行运维操作。\*\*

&#x20;   



\## \*\*Workbench的服务关联角色\*\*



由于Workbench需要操作您的ECS实例，因此，在首次使用Workbench连接实例时，会提示您创建服务关联角色`AliyunServiceRoleForECSWorkbench`，Workbench服务会以该角色的身份访问您的ECS实例。更多服务关联角色的说明，请参见\[服务关联角色](https://help.aliyun.com/zh/ram/user-guide/service-linked-roles#concept-2448621)。



如图所示，在首次连接实例时会出现以下对话框，单击\*\*确定\*\*系统会自动为您创建该服务关联角色。



!\[image](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/7674991371/p872259.png)



如果您是RAM用户，您需要联系主账号或管理员为您授予`AliyunECSWorkbenchFullAccess`系统权限策略，拥有该权限的用户才可以创建Workbench的服务关联角色。



\## \*\*RAM用户使用Workbench的权限设置\*\*



在开通服务关联角色后，RAM用户使用Workbench需设置如下权限策略，该策略代表用户可以使用Workbench连接所有ECS实例。



```

{

&#x20; "Version": "1",

&#x20; "Statement": \[

&#x20;   {

&#x20;     "Action": "ecs-workbench:LoginInstance",

&#x20;     "Resource": "\*",

&#x20;     "Effect": "Allow"

&#x20;   }

&#x20; ]

}

```



如果需要限制用户可以通过Workbench连接的实例，可通过修改Resource字段实现，格式如下：



```

{

&#x20; "Version": "1",

&#x20; "Statement": \[

&#x20;   {

&#x20;     "Action": "ecs-workbench:LoginInstance",

&#x20;     "Resource": \[

&#x20;       "acs:ecs-workbench:{#regionId}:{#accountId}:workbench/{#instanceId}",

&#x20;       "acs:ecs-workbench:{#regionId}:{#accountId}:workbench/{#instanceId}"

&#x20;     ],

&#x20;     "Effect": "Allow"

&#x20;   }

&#x20; ]

}

```



参数说明如下：



\-   `\*\*{#regionId}\*\*`\*\*：实例所在地域ID\*\*，可设置为通配符`\*`。

&#x20;   

\-   `\*\*{#accountId}\*\*`\*\*：主账号ID\*\*，可设置为通配符`\*`。

&#x20;   

\-   `\*\*{#instanceId}\*\*`：\*\*目标实例ID\*\*，可设置为通配符`\*`。

&#x20;   



\*\*示例\*\*



例如，设置RAM用户可使用Workbench连接所有地域和账号下实例ID为`i-001`和`i-002`的实例时，可设置以下权限策略。



```

{

&#x20; "Version": "1",

&#x20; "Statement": \[

&#x20;   {

&#x20;     "Action": "ecs-workbench:LoginInstance",

&#x20;     "Resource": \[

&#x20;       "acs:ecs-workbench:\*:\*:workbench/i-001",

&#x20;       "acs:ecs-workbench:\*:\*:workbench/i-002"

&#x20;     ],

&#x20;     "Effect": "Allow"

&#x20;   }

&#x20; ]

}

```



\## \*\*Workbench相关安全组设置\*\*



由于使用Workbench通过SSH或RDP方式连接实例时，您需要在实例所在安全组放通来自Workbench服务端的入网流量，您可以根据您网络类型的不同，参考下表添加安全组规则。具体操作，请参见\[添加安全组规则](https://help.aliyun.com/zh/ecs/user-guide/start-using-security-groups#233050ea35twy)。



\*\*重要\*\*



如果您在实例系统内开启了防火墙，请参照安全组修改防火墙规则。



| \*\*授权策略\*\* | \*\*优先级\*\* | \*\*协议类型\*\* | \*\*端口范围\*\* | \*\*授权对象\*\* |

| \*\*允许\*\* | 1   | \*\*自定义TCP\*\* | 配置的端口取决于您实例内运行的远程连接服务的端口。 - \*\*连接Linux实例：\*\* 选择\*\*SSH (22)\*\*。 > Linux实例默认远程连接服务为SSH，默认端口为\*\*22\*\*。 - \*\*连接Windows实例：\*\* 选择\*\*RDP (3389)\*\*。 > Windows实例默认远程连接服务为RDP，默认端口为\*\*3389\*\*。 \*\*重要\*\* 如果您在实例内修改了相关远程服务的端口，请根据实际情况进行设置。 | - \*\*通过公网连接：\*\*添加`47.96.60.0/24, 118.31.243.0/24, 8.139.112.0/24, 8.139.99.192/26`。 - \*\*通过私网连接：\*\*添加`100.104.0.0/16`。 \*\*警告\*\* 使用`0.0.0.0/0`，代表所有IP地址均可以连接远程服务端口，该配置存在安全风险，请谨慎使用。 |

