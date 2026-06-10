import { AsyncPipe, CommonModule, DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { LedgerService } from './ledger.service';
import { DebtItem, LoanRequest, MonthlyPayment, UserRole } from './models';

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
    dueDate: [this.nextMonthDate(), [Validators.required]],
    debtItemId: ['', [Validators.required]],
    plannedAmount: [0, [Validators.required, Validators.min(1)]],
  });

  readonly quickAmounts = [1000, 3000, 5000, 10000];
  readonly roleName = computed(() => (this.role() === 'shuni' ? '淑尼' : '丞恩'));
  readonly loanTabLabel = computed(() => (this.role() === 'shuni' ? '貸款簽核' : '申請貸款'));

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

  async setPlannedPayment(amount?: number): Promise<void> {
    if (amount) {
      this.paymentForm.patchValue({ plannedAmount: amount });
    }
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }
    await this.ledgerService.setMonthlyPayment(this.paymentForm.getRawValue());
    this.view.set('home');
  }

  async markPaid(payment: MonthlyPayment): Promise<void> {
    await this.ledgerService.markMonthlyPaymentPaid(payment.id);
  }

  async confirmPaid(payment: MonthlyPayment): Promise<void> {
    await this.ledgerService.confirmMonthlyPayment(payment.id);
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  paymentDateLabel(payment: MonthlyPayment): string {
    return payment.dueDate ?? payment.month;
  }

  paymentDebtTitle(payment: MonthlyPayment, items: DebtItem[]): string {
    return items.find((item) => item.id === payment.debtItemId)?.title ?? '未指定欠款';
  }

  loanDateLabel(request: LoanRequest): string {
    return request.requestDate ?? new Date(request.createdAt).toISOString().slice(0, 10);
  }

  unpaidItems(items: DebtItem[]): DebtItem[] {
    return items.filter((item) => item.totalAmount > item.paidAmount);
  }

  pendingLoanRequests(requests: LoanRequest[]): LoanRequest[] {
    return requests.filter((request) => request.status === 'pending');
  }

  today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private nextMonthDate(): string {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 10);
  }

}
