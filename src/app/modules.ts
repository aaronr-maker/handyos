import type { ModuleManifest } from '@/core';
import { cashplanModule } from '@/modules/cashplan';
import { customersModule } from '@/modules/customers';
import { addressesModule } from '@/modules/addresses';
import { dashboardModule } from '@/modules/dashboard';
import { todayModule } from '@/modules/today';
import { deskModule } from '@/modules/desk';
import { estimatesModule } from '@/modules/estimates';
import { handyModule } from '@/modules/handy';
import { invoicingModule } from '@/modules/invoicing';
import { jobcostingModule } from '@/modules/jobcosting';
import { jobsModule } from '@/modules/jobs';
import { messagingModule } from '@/modules/messaging';
import { paymentsModule } from '@/modules/payments';
import { qbsyncModule } from '@/modules/qbsync';
import { revenueModule } from '@/modules/revenue';
import { timesheetsModule } from '@/modules/timesheets';
import { timetrackModule } from '@/modules/timetrack';
import { phoneModule } from '@/modules/phone';
import { jobsdataModule } from '@/modules/jobsdata';
import { receptionistModule } from '@/modules/receptionist';
import { salesModule } from '@/modules/sales';
import { schedulingModule } from '@/modules/scheduling';

/** The only place the app learns which modules exist. Order = sidebar order. */
export const modules: ModuleManifest[] = [
  todayModule,
  dashboardModule,
  jobsdataModule,
  salesModule,
  customersModule,
  estimatesModule,
  jobsModule,
  timetrackModule,
  timesheetsModule,
  deskModule,
  handyModule,
  schedulingModule,
  invoicingModule,
  paymentsModule,
  jobcostingModule,
  cashplanModule,
  revenueModule,
  qbsyncModule,
  messagingModule,
  phoneModule,
  receptionistModule,
  addressesModule,
];
