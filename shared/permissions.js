export const PERMISSIONS = [
  {
    key: "bookings.review",
    label: "企业申请审核",
    description: "查看企业申请与设计图，审批或退回申请",
  },
  {
    key: "notices.manage",
    label: "公告管理",
    description: "发布、编辑、置顶和删除公告",
  },
  {
    key: "venue.manage",
    label: "场地开放管理",
    description: "创建及解除桁架暂停开放安排",
  },
  {
    key: "accounts.manage",
    label: "企业账号管理",
    description: "启停企业账号、核验后重置企业密码",
  },
  {
    key: "audit.read",
    label: "操作日志查看",
    description: "查看管理操作的审计记录",
  },
];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
export const can = (user, permission) =>
  !!user &&
  user.role === "admin" &&
  (user.isSuperAdmin || !!user.permissions?.includes(permission));
