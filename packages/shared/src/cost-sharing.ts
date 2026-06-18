export const COST_SHARING_SPLIT_MODES = ["equal", "custom"] as const;

export type CostSharingSplitMode = (typeof COST_SHARING_SPLIT_MODES)[number];

export interface CostSharingMember {
  id: string;
  name: string;
  note?: string | undefined;
  currency?: string | undefined;
  included: boolean;
  customAmount?: number | undefined;
}

export interface CostSharing {
  enabled: boolean;
  payerMemberId: string;
  selfMemberId: string;
  splitMode: CostSharingSplitMode;
  members: CostSharingMember[];
}

export interface CostSharingSummary {
  enabled: boolean;
  total: number;
  yourShare: number;
  /** familyContribution 是家庭其他成员承担的金额，统计页个人口径会用 total - yourShare 收敛展示。 */
  familyContribution: number;
  /** 只有当前用户也是付款人时，其他成员份额才属于可追回金额；非付款人不能把别人的支付义务算作应收。 */
  recoverableAmount: number;
  includedCount: number;
}

export type CostSharingCurrencyConverter = (amount: number, fromCurrency: string, toCurrency: string) => number;

export interface CostSharingCalculationOptions {
  baseCurrency?: string | undefined;
  convert?: CostSharingCurrencyConverter | undefined;
}

const MONEY_EPSILON = 0.01;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isCostSharingEnabled(costSharing: CostSharing | undefined): costSharing is CostSharing {
  return Boolean(costSharing?.enabled && costSharing.members.length > 0);
}

function convertMemberAmountToBase(
  amount: number,
  member: CostSharingMember,
  options: CostSharingCalculationOptions | undefined,
): number {
  const baseCurrency = options?.baseCurrency;
  const memberCurrency = member.currency ?? baseCurrency;
  // 跨币种分摊只在调用方提供基础币种和转换器时换算；否则保留原金额，避免 shared 层猜测汇率。
  if (!baseCurrency || !memberCurrency || memberCurrency === baseCurrency || !options?.convert) return amount;
  return options.convert(amount, memberCurrency, baseCurrency);
}

export function calculateCostSharingMemberAmount(
  costSharing: CostSharing,
  member: CostSharingMember,
  total: number,
  options?: CostSharingCalculationOptions,
): number {
  if (!member.included) return 0;
  if (costSharing.splitMode === "custom") {
    return roundMoney(convertMemberAmountToBase(member.customAmount ?? 0, member, options));
  }
  const includedCount = costSharing.members.filter((item) => item.included).length;
  if (includedCount <= 0) return 0;
  return roundMoney(total / includedCount);
}

export function calculateCostSharingSummary(
  costSharing: CostSharing | undefined,
  total: number,
  options?: CostSharingCalculationOptions,
): CostSharingSummary {
  if (!isCostSharingEnabled(costSharing)) {
    return {
      enabled: false,
      total,
      yourShare: total,
      familyContribution: 0,
      recoverableAmount: 0,
      includedCount: 0,
    };
  }

  const includedMembers = costSharing.members.filter((member) => member.included);
  const selfMember = costSharing.members.find((member) => member.id === costSharing.selfMemberId);
  const yourShare = selfMember ? calculateCostSharingMemberAmount(costSharing, selfMember, total, options) : total;
  // Summary 的金额统一回到订阅原币种，调用方再决定展示总额口径还是个人口径。
  const familyContribution = roundMoney(Math.max(total - yourShare, 0));
  const recoverableAmount = costSharing.payerMemberId === costSharing.selfMemberId ? familyContribution : 0;

  return {
    enabled: true,
    total,
    yourShare,
    familyContribution,
    recoverableAmount,
    includedCount: includedMembers.length,
  };
}

export function costSharingCustomTotalMatches(
  costSharing: CostSharing,
  total: number,
  options?: CostSharingCalculationOptions,
): boolean {
  if (costSharing.splitMode !== "custom") return true;
  // 无基础币种时无法证明多币种 custom 总额等于订阅价格；写入层只能校验同币种总额，跨币种由前端带汇率转换器兜住。
  if (!options?.baseCurrency && costSharing.members.some((member) => member.included && member.currency)) return true;
  const customTotal = costSharing.members.reduce((sum, member) => {
    if (!member.included) return sum;
    return sum + convertMemberAmountToBase(member.customAmount ?? 0, member, options);
  }, 0);
  return Math.abs(roundMoney(customTotal) - roundMoney(total)) <= MONEY_EPSILON;
}
