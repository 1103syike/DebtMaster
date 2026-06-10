export type UserRole = 'shuni' | 'chengen';
export type LoanStatus = 'pending' | 'approved' | 'rejected';
export type PaymentStatus = 'planned' | 'paid' | 'confirmed';

export interface DebtItem {
  id: string;
  title: string;
  totalAmount: number;
  paidAmount: number;
  note?: string;
  createdAt: number;
}

export interface LoanRequest {
  id: string;
  title: string;
  amount: number;
  requestDate?: string;
  note?: string;
  status: LoanStatus;
  createdAt: number;
  reviewedAt?: number;
  approvedAt?: number;
  rejectedAt?: number;
}

export interface MonthlyPayment {
  id: string;
  month: string;
  dueDate?: string;
  debtItemId?: string;
  plannedAmount: number;
  paidAmount: number;
  status: PaymentStatus;
  paidAt?: number;
  confirmedAt?: number;
}

export interface Ledger {
  items: DebtItem[];
  loanRequests: LoanRequest[];
  monthlyPayments: MonthlyPayment[];
  updatedAt: number;
}

export interface Summary {
  totalDebt: number;
  totalPaid: number;
  remainingDebt: number;
  paidPercent: number;
  nextPayment?: MonthlyPayment;
}
