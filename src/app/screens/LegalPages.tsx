/** Public pages (no sign-in): Intuit and other services require a privacy policy and terms of use at a public web address. */
const UPDATED = 'November 2026';
const CONTACT = 'aaronr@thathandymanvan.com';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="page" style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1>{title}</h1>
      <p className="muted">HandyOS, operated by That Handyman Van LLC. Last updated {UPDATED}.</p>
      {children}
      <p className="muted">Questions: {CONTACT}</p>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <Shell title="Privacy Policy">
      <h2>What HandyOS is</h2>
      <p>HandyOS is business software for field-service companies: customers, quotes, jobs, scheduling, invoices and job costing.</p>
      <h2>What we collect</h2>
      <p>Account details (name, email), the business data you enter (customers, jobs, invoices, time entries), and, if you connect QuickBooks Online, the Profit and Loss figures (income and expense account totals) for the months you choose.</p>
      <h2>How we use it</h2>
      <p>Only to provide the service to your company: for example, working out your company hourly cost. We do not sell your data, share it for advertising, or use QuickBooks data for anything other than your own company's reports inside HandyOS.</p>
      <h2>QuickBooks connection</h2>
      <p>Connecting QuickBooks is optional and done by an owner or admin. We read reports only; we never change anything in your QuickBooks. Connection tokens are encrypted and are not visible to other users. You can disconnect at any time in HandyOS, or remove access from your Intuit account, and we then delete the stored tokens.</p>
      <h2>Who can see your data</h2>
      <p>Only people in your company, according to the roles you assign. Each company's data is kept separate from every other company's. Our hosting providers (Supabase and Vercel) store data on our behalf.</p>
      <h2>Keeping and deleting data</h2>
      <p>You can ask us to delete your company's data at any time by emailing {CONTACT}.</p>
      <h2>Text messages</h2>
      <p>
        If you give That Handyman Van LLC your mobile number and agree to receive texts, we use it to send messages about your service: appointment confirmations and reminders, "on the way" notices, estimates, invoices and replies to your questions.
        Agreeing to texts is not a condition of buying anything. Message frequency varies with your jobs. Message and data rates may apply. Reply STOP at any time to stop receiving texts, or HELP for help.
      </p>
      <p>No mobile information, including phone numbers and text-messaging consent, is shared with third parties or affiliates for marketing or promotional purposes. We use a messaging service provider only to deliver your messages.</p>
      <h2>Security</h2>
      <p>Data is sent over HTTPS and stored in access-controlled databases with per-company row-level security.</p>
    </Shell>
  );
}

export function TermsPage() {
  return (
    <Shell title="Terms of Use">
      <h2>Using HandyOS</h2>
      <p>HandyOS is provided to help you run your business. You are responsible for the accuracy of the data you enter and for the people you give access to.</p>
      <h2>Your data</h2>
      <p>Your business data stays yours. We use it only to provide the service, as described in our <a href="/privacy">Privacy Policy</a>.</p>
      <h2>Third-party services</h2>
      <p>If you connect QuickBooks Online, your use of QuickBooks is also governed by Intuit's terms. HandyOS only reads reports from it.</p>
      <h2>No warranty</h2>
      <p>The service is provided "as is". Figures such as hourly rates are aids to your decisions; check them against your own books and advisers. To the extent allowed by law, we are not liable for indirect losses.</p>
      <h2>Text message terms</h2>
      <p>
        Customers who opt in receive service texts from That Handyman Van LLC (appointment confirmations and reminders, on-the-way notices, estimates, invoices and replies). Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply.
        Reply STOP to cancel and HELP for help. Carriers are not liable for delayed or undelivered messages. See our <a href="/privacy">Privacy Policy</a> for how phone numbers are used and protected.
      </p>
      <h2>Ending use</h2>
      <p>You may stop using HandyOS at any time and ask us to delete your data. We may suspend accounts that misuse the service.</p>
    </Shell>
  );
}
