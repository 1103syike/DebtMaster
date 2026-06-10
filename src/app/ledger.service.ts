import { Injectable } from '@angular/core';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { doc, getFirestore, onSnapshot, runTransaction } from 'firebase/firestore';
import { Observable, defer, from, switchMap } from 'rxjs';

import { DebtItem, Ledger, LoanRequest, MonthlyPayment, Summary } from './models';

const LEDGER_ID = 'family-ledger';

const EMPTY_LEDGER: Ledger = {
  items: [],
  loanRequests: [],
  monthlyPayments: [],
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

  async requestLoan(input: { requestDate: string; title: string; amount: number; note: string }): Promise<void> {
    await this.update((ledger) => ({
      ...ledger,
      loanRequests: [
        this.cleanLoanRequest({
          id: crypto.randomUUID(),
          title: input.title,
          amount: Number(input.amount),
          requestDate: input.requestDate,
          note: input.note,
          status: 'pending',
          createdAt: Date.now(),
        }),
        ...ledger.loanRequests,
      ],
    }));
  }

  async updateLoanStatus(id: string, status: 'approved' | 'rejected'): Promise<void> {
    await this.update((ledger) => {
      const request = ledger.loanRequests.find((item) => item.id === id);
      if (!request) {
        return ledger;
      }
      const reviewedAt = Date.now();

      return {
        ...ledger,
        loanRequests: ledger.loanRequests.map((item) =>
          item.id === id
            ? {
                ...item,
                status,
                reviewedAt,
                approvedAt: status === 'approved' ? reviewedAt : item.approvedAt,
                rejectedAt: status === 'rejected' ? reviewedAt : item.rejectedAt,
              }
            : item,
        ),
        items:
          status === 'approved'
            ? [
                {
                  id: crypto.randomUUID(),
                  title: request.title,
                  totalAmount: request.amount,
                  paidAmount: 0,
                  note: request.note,
                  createdAt: request.requestDate ? new Date(`${request.requestDate}T00:00:00`).getTime() : Date.now(),
                },
                ...ledger.items,
              ]
            : ledger.items,
      };
    });
  }

  async setMonthlyPayment(input: { dueDate: string; debtItemId: string; plannedAmount: number }): Promise<void> {
    await this.update((ledger) => {
      const plannedAmount = Number(input.plannedAmount);
      const month = input.dueDate.slice(0, 7);
      const existing = ledger.monthlyPayments.find(
        (payment) =>
          (payment.dueDate ?? payment.month) === input.dueDate &&
          (payment.debtItemId ?? '') === input.debtItemId &&
          payment.status === 'paid',
      );
      const payment: MonthlyPayment = existing
        ? {
            ...existing,
            month,
            dueDate: input.dueDate,
            debtItemId: input.debtItemId,
            plannedAmount,
            paidAmount: plannedAmount,
            paidAt: Date.now(),
          }
        : {
            id: crypto.randomUUID(),
            month,
            dueDate: input.dueDate,
            debtItemId: input.debtItemId,
            plannedAmount,
            paidAmount: plannedAmount,
            status: 'paid',
            paidAt: Date.now(),
          };

      return {
        ...ledger,
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

      return {
        ...ledger,
        items,
        monthlyPayments: ledger.monthlyPayments.map((item) =>
          item.id === id ? { ...item, status: 'confirmed', confirmedAt: Date.now() } : item,
        ),
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
