import { Injectable } from '@angular/core';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { doc, getFirestore, onSnapshot, runTransaction } from 'firebase/firestore';
import { Observable, defer, from, switchMap } from 'rxjs';

import { DebtItem, Ledger, LoanRequest, MonthlyPayment, Summary, UserRole } from './models';

const LEDGER_ID = 'family-ledger';

const EMPTY_LEDGER: Ledger = {
  items: [],
  loanRequests: [],
  monthlyPayments: [],
  actions: [],
  updatedAt: 0,
};

@Injectable({ providedIn: 'root' })
export class LedgerService {
  private readonly auth = getAuth();
  private readonly firestore = getFirestore();
  private readonly ledgerRef = doc(this.firestore, `ledgers/${LEDGER_ID}`);

  readonly ledger$: Observable<Ledger> = defer(() => from(this.ensureSession())).pipe(
    switchMap(
      () =>
        new Observable<Ledger>((subscriber) =>
          onSnapshot(
            this.ledgerRef,
            (snapshot) => subscriber.next({ ...EMPTY_LEDGER, ...(snapshot.data() as Ledger | undefined) }),
            (error) => subscriber.error(error),
          ),
        ),
    ),
  );

  summary(items: DebtItem[], monthlyPayments: MonthlyPayment[]): Summary {
    const totalDebt = items.reduce((sum, item) => sum + item.totalAmount, 0);
    const totalPaid = items.reduce((sum, item) => sum + item.paidAmount, 0);
    const nextPayment = [...monthlyPayments]
      .filter((payment) => payment.status !== 'confirmed')
      .sort((a, b) => (a.dueDate ?? a.month).localeCompare(b.dueDate ?? b.month))[0];

    return {
      totalDebt,
      totalPaid,
      remainingDebt: Math.max(0, totalDebt - totalPaid),
      paidPercent: totalDebt > 0 ? Math.min(100, Math.round((totalPaid / totalDebt) * 100)) : 0,
      nextPayment,
    };
  }

  async requestLoan(input: { title: string; amount: number; note: string }): Promise<void> {
    await this.update((ledger) => {
      const request = this.cleanLoanRequest({
        id: crypto.randomUUID(),
        title: input.title,
        amount: Number(input.amount),
        requestDate: this.today(),
        note: input.note,
        status: 'pending',
        createdAt: Date.now(),
      });

      return {
        ...this.addAction(ledger, 'chengen', `[${request.title}] 丞恩申請貸款 ${this.formatMoney(request.amount)}`),
        loanRequests: [request, ...ledger.loanRequests],
      };
    });
  }

  async updateLoanStatus(id: string, status: 'approved' | 'rejected'): Promise<void> {
    await this.update((ledger) => {
      const request = ledger.loanRequests.find((item) => item.id === id);
      if (!request) {
        return ledger;
      }
      const reviewedAt = Date.now();
      const isCorrection = request.status !== 'pending' && request.status !== status;

      return {
        ...this.addAction(
          ledger,
          'shuni',
          status === 'approved'
            ? `[${request.title}] ${isCorrection ? '淑尼更正為核准貸款' : '淑尼核准貸款'} ${this.formatMoney(request.amount)}`
            : `[${request.title}] ${isCorrection ? '淑尼更正為退回貸款' : '淑尼退回貸款'} ${this.formatMoney(request.amount)}`,
        ),
        loanRequests: ledger.loanRequests.map((item) =>
          item.id === id ? this.reviewedLoanRequest(item, status, reviewedAt) : item,
        ),
        items:
          status === 'approved'
            ? ledger.items.some((item) => item.loanRequestId === request.id)
              ? ledger.items
              : [
                {
                  id: crypto.randomUUID(),
                  loanRequestId: request.id,
                  title: request.title,
                  totalAmount: request.amount,
                  paidAmount: 0,
                  note: request.note,
                  createdAt: request.requestDate ? new Date(`${request.requestDate}T00:00:00`).getTime() : Date.now(),
                },
                ...ledger.items,
              ]
            : ledger.items.filter((item) => item.loanRequestId !== request.id || item.paidAmount > 0),
      };
    });
  }

  async setMonthlyPayment(input: { debtItemId: string; plannedAmount: number }): Promise<void> {
    await this.update((ledger) => {
      const plannedAmount = Number(input.plannedAmount);
      const dueDate = this.today();
      const month = dueDate.slice(0, 7);
      const existing = ledger.monthlyPayments.find(
        (payment) =>
          (payment.dueDate ?? payment.month) === dueDate &&
          (payment.debtItemId ?? '') === input.debtItemId &&
          payment.status === 'paid',
      );
      const payment: MonthlyPayment = existing
        ? {
            ...existing,
            month,
            dueDate,
            debtItemId: input.debtItemId,
            plannedAmount,
            paidAmount: plannedAmount,
            paidAt: Date.now(),
          }
        : {
            id: crypto.randomUUID(),
            month,
            dueDate,
            debtItemId: input.debtItemId,
            plannedAmount,
            paidAmount: plannedAmount,
            status: 'paid',
            paidAt: Date.now(),
          };

      const debtTitle = this.debtTitle(ledger.items, input.debtItemId);

      return {
        ...this.addAction(ledger, 'chengen', `[${debtTitle}] 丞恩還款 ${this.formatMoney(plannedAmount)}`),
        monthlyPayments: [payment, ...ledger.monthlyPayments.filter((item) => item.id !== payment.id)],
      };
    });
  }

  async markMonthlyPaymentPaid(id: string): Promise<void> {
    await this.update((ledger) => ({
      ...ledger,
      monthlyPayments: ledger.monthlyPayments.map((payment) =>
        payment.id === id
          ? { ...payment, paidAmount: payment.plannedAmount, status: 'paid', paidAt: Date.now() }
          : payment,
      ),
    }));
  }

  async confirmMonthlyPayment(id: string): Promise<void> {
    await this.update((ledger) => {
      const payment = ledger.monthlyPayments.find((item) => item.id === id);
      if (!payment || payment.status !== 'paid') {
        return ledger;
      }

      const items = payment.debtItemId
        ? ledger.items.map((item) => {
            if (item.id !== payment.debtItemId) {
              return item;
            }
            const unpaid = Math.max(0, item.totalAmount - item.paidAmount);
            return { ...item, paidAmount: item.paidAmount + Math.min(payment.paidAmount, unpaid) };
          })
        : this.allocatePaymentToOldestItems(ledger.items, payment.paidAmount);

      const debtTitle = this.debtTitle(ledger.items, payment.debtItemId);

      return {
        ...this.addAction(ledger, 'shuni', `[${debtTitle}] 淑尼已收到 ${this.formatMoney(payment.paidAmount)}`),
        items,
        monthlyPayments: ledger.monthlyPayments.map((item) =>
          item.id === id ? { ...item, status: 'confirmed', confirmedAt: Date.now() } : item,
        ),
      };
    });
  }

  async unconfirmMonthlyPayment(id: string): Promise<void> {
    await this.update((ledger) => {
      const payment = ledger.monthlyPayments.find((item) => item.id === id);
      if (!payment || payment.status !== 'confirmed') {
        return ledger;
      }

      const items = payment.debtItemId
        ? ledger.items.map((item) =>
            item.id === payment.debtItemId
              ? { ...item, paidAmount: Math.max(0, item.paidAmount - payment.paidAmount) }
              : item,
          )
        : ledger.items;

      const debtTitle = this.debtTitle(ledger.items, payment.debtItemId);

      return {
        ...this.addAction(ledger, 'shuni', `[${debtTitle}] 淑尼已更正未收到 ${this.formatMoney(payment.paidAmount)}`),
        items,
        monthlyPayments: ledger.monthlyPayments.map((item) => {
          if (item.id !== id) {
            return item;
          }
          const { confirmedAt, ...pendingPayment } = item;
          return { ...pendingPayment, status: 'paid' };
        }),
      };
    });
  }

  private cleanLoanRequest(request: LoanRequest): LoanRequest {
    return {
      ...request,
      title: request.title.trim(),
      requestDate: request.requestDate,
      note: request.note?.trim(),
    };
  }

  private reviewedLoanRequest(request: LoanRequest, status: 'approved' | 'rejected', reviewedAt: number): LoanRequest {
    const { approvedAt, rejectedAt, ...base } = request;
    return {
      ...base,
      status,
      reviewedAt,
      ...(status === 'approved' ? { approvedAt: reviewedAt } : { rejectedAt: reviewedAt }),
    };
  }

  private async update(mutator: (ledger: Ledger) => Ledger): Promise<void> {
    await this.ensureSession();

    await runTransaction(this.firestore, async (transaction) => {
      const snapshot = await transaction.get(this.ledgerRef);
      const current = { ...EMPTY_LEDGER, ...(snapshot.data() as Ledger | undefined) };
      transaction.set(this.ledgerRef, { ...mutator(current), updatedAt: Date.now() });
    });
  }

  private async ensureSession(): Promise<void> {
    if (!this.auth.currentUser) {
      await signInAnonymously(this.auth);
    }
  }

  private today(): string {
    return new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private addAction(ledger: Ledger, actor: UserRole, text: string): Ledger {
    return {
      ...ledger,
      actions: [
        {
          id: crypto.randomUUID(),
          actor,
          text,
          createdAt: Date.now(),
          deviceInfo: this.deviceInfo(),
        },
        ...ledger.actions,
      ],
    };
  }

  private debtTitle(items: DebtItem[], debtItemId?: string): string {
    return items.find((item) => item.id === debtItemId)?.title ?? '未指定欠款';
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private deviceInfo(): string {
    const userAgent = navigator.userAgent;
    const platform = navigator.platform;
    const isIphone = /iPhone/i.test(userAgent);
    const isIpad = /iPad/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(userAgent);
    const isMac = /Macintosh|MacIntel/i.test(userAgent);
    const isWindows = /Windows/i.test(userAgent);
    const isChrome = /CriOS|Chrome/i.test(userAgent) && !/Edg/i.test(userAgent);
    const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS|Android/i.test(userAgent);
    const isEdge = /Edg/i.test(userAgent);

    const device = isIphone ? 'iPhone' : isIpad ? 'iPad' : isAndroid ? 'Android' : isMac ? 'Mac' : isWindows ? 'Windows' : '裝置';
    const browser = isEdge ? 'Edge' : isChrome ? 'Chrome' : isSafari ? 'Safari' : '瀏覽器';

    return `${device} ${browser}`;
  }

  private allocatePaymentToOldestItems(items: DebtItem[], amount: number): DebtItem[] {
    return items.reduce(
      (state, item) => {
        const unpaid = Math.max(0, item.totalAmount - item.paidAmount);
        const applied = Math.min(state.remaining, unpaid);
        return {
          remaining: state.remaining - applied,
          items: [...state.items, { ...item, paidAmount: item.paidAmount + applied }],
        };
      },
      { remaining: amount, items: [] as DebtItem[] },
    ).items;
  }
}
