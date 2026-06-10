import { Injectable } from '@angular/core';
import { Firestore, doc, docData, runTransaction } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';

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
  private readonly ledgerRef = doc(this.firestore, `ledgers/${LEDGER_ID}`);

  readonly ledger$: Observable<Ledger> = docData(this.ledgerRef).pipe(
    map((ledger) => ({ ...EMPTY_LEDGER, ...(ledger as Ledger | undefined) })),
  );

  constructor(private readonly firestore: Firestore) {}

  summary(items: DebtItem[], monthlyPayments: MonthlyPayment[]): Summary {
    const totalDebt = items.reduce((sum, item) => sum + item.totalAmount, 0);
    const totalPaid = items.reduce((sum, item) => sum + item.paidAmount, 0);
    const nextPayment = [...monthlyPayments]
      .filter((payment) => payment.status !== 'confirmed')
      .sort((a, b) => a.month.localeCompare(b.month))[0];

    return {
      totalDebt,
      totalPaid,
      remainingDebt: Math.max(0, totalDebt - totalPaid),
      paidPercent: totalDebt > 0 ? Math.min(100, Math.round((totalPaid / totalDebt) * 100)) : 0,
      nextPayment,
    };
  }

  async requestLoan(input: { title: string; amount: number; note: string }): Promise<void> {
    await this.update((ledger) => ({
      ...ledger,
      loanRequests: [
        this.cleanLoanRequest({
          id: crypto.randomUUID(),
          title: input.title,
          amount: Number(input.amount),
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

      return {
        ...ledger,
        loanRequests: ledger.loanRequests.map((item) => (item.id === id ? { ...item, status } : item)),
        items:
          status === 'approved'
            ? [
                {
                  id: crypto.randomUUID(),
                  title: request.title,
                  totalAmount: request.amount,
                  paidAmount: 0,
                  note: request.note,
                  createdAt: Date.now(),
                },
                ...ledger.items,
              ]
            : ledger.items,
      };
    });
  }

  async setMonthlyPayment(input: { month: string; plannedAmount: number }): Promise<void> {
    await this.update((ledger) => {
      const plannedAmount = Number(input.plannedAmount);
      const existing = ledger.monthlyPayments.find((payment) => payment.month === input.month);
      const payment: MonthlyPayment = existing
        ? { ...existing, plannedAmount }
        : {
            id: crypto.randomUUID(),
            month: input.month,
            plannedAmount,
            paidAmount: 0,
            status: 'planned',
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

      const remainingPayment = payment.paidAmount;
      const allocation = ledger.items.reduce(
        (state, item) => {
          const unpaid = Math.max(0, item.totalAmount - item.paidAmount);
          const applied = Math.min(state.remaining, unpaid);
          return {
            remaining: state.remaining - applied,
            items: [...state.items, { ...item, paidAmount: item.paidAmount + applied }],
          };
        },
        { remaining: remainingPayment, items: [] as DebtItem[] },
      );

      return {
        ...ledger,
        items: allocation.items,
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
      note: request.note?.trim(),
    };
  }

  private async update(mutator: (ledger: Ledger) => Ledger): Promise<void> {
    await runTransaction(this.firestore, async (transaction) => {
      const snapshot = await transaction.get(this.ledgerRef);
      const current = { ...EMPTY_LEDGER, ...(snapshot.data() as Ledger | undefined) };
      transaction.set(this.ledgerRef, { ...mutator(current), updatedAt: Date.now() });
    });
  }
}
