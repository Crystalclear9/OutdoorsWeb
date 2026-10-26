// Approval, fees and cancellation are separate facts. Never infer payment from
// approval or a submitted receipt, and give cancellation precedence over fees.
export function bookingNextStep(item, today) {
  const fee = item.fee?.state;
  if (item.cancelled || item.status === "已取消") {
    if (fee === "paid")
      return {
        title: "等待财务办理退款",
        detail: "原预约已取消，已收款项待财务办理退款。",
      };
    if (fee === "reconcile")
      return {
        title: "等待财务核对原付款",
        detail: "财务正在核对原付款流水，到账款项将进入退款办理。",
      };
    if (fee === "refunded")
      return {
        title: "核对退款到账",
        detail: "财务已登记全额退款，可展开费用记录查看退款说明。",
      };
    return {
      title: "预约已取消，无需继续缴费",
      detail: "本次预约已结束办理。如有已付款项，可联系财务查询退款。",
    };
  }
  if (item.reviewExpired || item.status === "过期未审核")
    return {
      title: "申请过期未审核",
      detail:
        "申请开始日期已过，不能继续审批；企业端显示未通过，如仍需布展请重新申报。",
    };
  if (item.status === "待审核")
    return {
      title: "等待管理员审核",
      detail: "管理员将审核日期、桁架宣传内容及搭建方信息。",
    };
  if (item.status === "未通过")
    return {
      title: "按审核意见调整后重新申请",
      detail: "根据申请详情中的审核意见调整材料，再提交新的申请。",
    };
  if (item.status === "已撤回")
    return {
      title: "申请已撤回",
      detail: "本次申请不再审核。如仍需使用场地，请重新提交申请。",
    };
  if (item.status !== "已通过")
    return { title: "请核对申请状态", detail: "刷新办理记录后查看最新安排。" };
  if (!fee || fee === "void")
    return {
      title: "等待财务发出费用安排",
      detail:
        fee === "void"
          ? "原费用单已作废，待财务更新缴费或免缴安排。"
          : "审批已通过，财务将确认缴费金额或免缴安排。",
    };
  if (fee === "due")
    return {
      title: "按通知缴费并提交付款流水",
      detail:
        "按收款说明完成线下付款后，填写付款时间和流水号。已付款可直接提交。",
    };
  if (fee === "submitted")
    return {
      title: "等待财务核实到账",
      detail: "付款流水已提交，等待财务确认到账。核对结果会更新到这里。",
    };
  if (fee === "refunded")
    return {
      title: "核对退款及后续场地安排",
      detail: "退款已登记，预约仍有效。请与管理员确认后续布展安排。",
    };
  if (fee === "paid" || fee === "waived")
    return {
      title: item.end < today ? "预约时段已结束" : "按批准日期准备布展",
      detail: `${fee === "paid" ? "财务已核实收款" : "财务已确认免缴"}。${item.end < today ? "请保留申请及费用记录；如需再次使用场地，请重新申请。" : "按批准日期在大活A座平台允许区域内布展，具体要求见审核意见。"}`,
    };
  return {
    title: "联系财务核对费用状态",
    detail: "联系财务确认费用安排。",
  };
}
