import { AsyncPipe, CommonModule, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { LedgerService } from './ledger.service';
import { DebtItem, LedgerAction, LoanRequest, MonthlyPayment, UserRole } from './models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, CommonModule, DecimalPipe, NgFor, NgIf, ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  readonly role = signal<UserRole | null>((localStorage.getItem('debt-master-role') as UserRole | null) ?? null);
  readonly view = signal<'home' | 'loan' | 'payment' | 'settings'>('home');
  readonly ledger$ = this.ledgerService.ledger$;
  readonly currentMonth = new Date().toISOString().slice(0, 7);

  readonly loanForm = this.fb.nonNullable.group({
    requestDate: [this.today(), [Validators.required]],
    title: ['', [Validators.required, Validators.maxLength(24)]],
    amount: [0, [Validators.required, Validators.min(1)]],
    note: ['', [Validators.maxLength(80)]],
  });

  readonly paymentForm = this.fb.nonNullable.group({
    debtItemId: ['', [Validators.required]],
    plannedAmount: [0, [Validators.required, Validators.min(1)]],
  });

  readonly quickAmounts = [1000, 3000, 5000, 10000];
  readonly roleName = computed(() => (this.role() === 'shuni' ? '淑尼' : '丞恩'));
  readonly loanTabLabel = computed(() => (this.role() === 'shuni' ? '貸款紀錄' : '申請貸款'));
  readonly paymentTabLabel = computed(() => (this.role() === 'shuni' ? '還款紀錄' : '還款申請'));

  constructor(
    private readonly fb: FormBuilder,
    private readonly ledgerService: LedgerService,
  ) {}

  chooseRole(role: UserRole): void {
    localStorage.setItem('debt-master-role', role);
    this.role.set(role);
    this.view.set('home');
  }

  clearRole(): void {
    localStorage.removeItem('debt-master-role');
    this.role.set(null);
  }

  summary(items: DebtItem[], monthlyPayments: MonthlyPayment[]) {
    return this.ledgerService.summary(items, monthlyPayments);
  }

  percent(total: number, paid: number): number {
    return total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  }

  money(value: number): string {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      maximumFractionDigits: 0,
    }).format(value || 0);
  }

  async submitLoan(): Promise<void> {
    if (this.loanForm.invalid) {
      this.loanForm.markAllAsTouched();
      return;
    }
    await this.ledgerService.requestLoan(this.loanForm.getRawValue());
    this.loanForm.reset({ requestDate: this.today(), title: '', amount: 0, note: '' });
    this.view.set('home');
  }

  async updateLoan(request: LoanRequest, status: 'approved' | 'rejected'): Promise<void> {
    await this.ledgerService.updateLoanStatus(request.id, status);
  }

  setQuickAmount(amount: number): void {
    this.paymentForm.patchValue({ plannedAmount: amount });
  }

  async setPlannedPayment(): Promise<void> {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }
    await this.ledgerService.setMonthlyPayment(this.paymentForm.getRawValue());
    this.paymentForm.reset({ debtItemId: '', plannedAmount: 0 });
    this.view.set('home');
  }

  async markPaid(payment: MonthlyPayment): Promise<void> {
    await this.ledgerService.markMonthlyPaymentPaid(payment.id);
  }

  async confirmPaid(payment: MonthlyPayment): Promise<void> {
    await this.ledgerService.confirmMonthlyPayment(payment.id);
  }

  async unconfirmPaid(payment: MonthlyPayment): Promise<void> {
    await this.ledgerService.unconfirmMonthlyPayment(payment.id);
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  paymentDateLabel(payment: MonthlyPayment): string {
    return payment.dueDate ?? payment.month;
  }

  paymentNoticeTitle(payment: MonthlyPayment): string {
    return payment.status === 'paid' ? '等待淑尼確認' : `${this.paymentDateLabel(payment)} 要還`;
  }

  paymentDebtTitle(payment: MonthlyPayment, items: DebtItem[]): string {
    return items.find((item) => item.id === payment.debtItemId)?.title ?? '未指定欠款';
  }

  selectedDebtItemId(): string {
    return this.paymentForm.controls.debtItemId.value;
  }

  selectDebtItem(item: DebtItem): void {
    this.paymentForm.patchValue({ debtItemId: item.id });
  }

  loanDateLabel(request: LoanRequest): string {
    return request.requestDate ?? new Date(request.createdAt).toISOString().slice(0, 10);
  }

  reviewedDateLabel(request: LoanRequest): string {
    const timestamp = request.approvedAt ?? request.rejectedAt ?? request.reviewedAt;
    return timestamp ? this.dateLabel(timestamp) : '';
  }

  loanReviewText(request: LoanRequest): string {
    if (request.approvedAt) {
      return `核准日：${this.dateLabel(request.approvedAt)}`;
    }
    if (request.rejectedAt) {
      return `退回日：${this.dateLabel(request.rejectedAt)}`;
    }
    return '';
  }

  canCorrectApprovedLoan(request: LoanRequest, items: DebtItem[]): boolean {
    const linkedItem = items.find((item) => item.loanRequestId === request.id);
    return request.status === 'approved' && !!linkedItem && linkedItem.paidAmount === 0;
  }

  confirmedDateLabel(payment: MonthlyPayment): string {
    return payment.confirmedAt ? this.dateLabel(payment.confirmedAt) : '';
  }

  unpaidItems(items: DebtItem[]): DebtItem[] {
    return items.filter((item) => item.totalAmount > item.paidAmount);
  }

  pendingPaymentRequests(payments: MonthlyPayment[]): MonthlyPayment[] {
    return payments
      .filter((payment) => payment.status === 'paid')
      .sort((a, b) => (a.dueDate ?? a.month).localeCompare(b.dueDate ?? b.month));
  }

  pendingHomeCount(requests: LoanRequest[], payments: MonthlyPayment[]): number {
    return this.pendingLoanRequests(requests).length + this.pendingPaymentRequests(payments).length;
  }

  confirmedPaymentRecords(payments: MonthlyPayment[]): MonthlyPayment[] {
    return payments
      .filter((payment) => payment.status === 'confirmed')
      .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0));
  }

  paymentRecords(payments: MonthlyPayment[]): MonthlyPayment[] {
    return [...payments].sort((a, b) => {
      const statusOrder = this.paymentStatusOrder(a.status) - this.paymentStatusOrder(b.status);
      if (statusOrder !== 0) {
        return statusOrder;
      }
      return (b.confirmedAt ?? b.paidAt ?? 0) - (a.confirmedAt ?? a.paidAt ?? 0);
    });
  }

  paymentStatusText(payment: MonthlyPayment): string {
    if (payment.status === 'paid') {
      return '等待確認';
    }
    if (payment.status === 'confirmed') {
      return '已入帳';
    }
    return '尚未送出';
  }

  currentPeriodLabel(item: DebtItem): string {
    const { start, end } = this.currentPeriod(item);
    return `${this.shortDate(start)}-${this.shortDate(end)}`;
  }

  paidInCurrentPeriod(item: DebtItem, payments: MonthlyPayment[]): number {
    const { startKey, endKey } = this.currentPeriod(item);
    return payments
      .filter((payment) => {
        const paymentDate = payment.dueDate ?? payment.month;
        return payment.status === 'confirmed' && payment.debtItemId === item.id && paymentDate >= startKey && paymentDate <= endKey;
      })
      .reduce((sum, payment) => sum + payment.paidAmount, 0);
  }

  pendingLoanRequests(requests: LoanRequest[]): LoanRequest[] {
    return requests.filter((request) => request.status === 'pending');
  }

  actionRecords(actions: LedgerAction[]): LedgerAction[] {
    return [...actions].sort((a, b) => b.createdAt - a.createdAt);
  }

  actionTimeLabel(action: LedgerAction): string {
    return new Intl.DateTimeFormat('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(action.createdAt));
  }

  today(): string {
    return this.dateLabel(Date.now());
  }

  private dateLabel(timestamp: number): string {
    return new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(timestamp));
  }

  private currentPeriod(item: DebtItem): { start: Date; end: Date; startKey: string; endKey: string } {
    const anchor = new Date(item.createdAt);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), anchor.getDate());
    if (today < start) {
      start.setMonth(start.getMonth() - 1);
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    return {
      start,
      end,
      startKey: this.dateLabel(start.getTime()),
      endKey: this.dateLabel(end.getTime()),
    };
  }

  private shortDate(date: Date): string {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  private paymentStatusOrder(status: MonthlyPayment['status']): number {
    if (status === 'paid') {
      return 0;
    }
    if (status === 'planned') {
      return 1;
    }
    return 2;
  }

}
