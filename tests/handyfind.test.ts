import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule } from '../src/modules/customers';
import { HANDY_TOOLS, runReadTool, type ToolContext } from '../src/modules/handy/tools';

describe('Handy finding a customer', () => {
  it('searches by name, company, email or phone, and tells him only the name and whether they can be texted or emailed', async () => {
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const co = 'coFind';
    const owner = { companyId: co, actor: { kind: 'user' as const, id: 'boss' }, role: 'owner' as const };
    await rt.actions.executeByName('customers.create', { first_name: 'Pat', last_name: 'Miller', phone: '5125550147', email: 'pat@example.com' }, owner);
    await rt.actions.executeByName('customers.create', { first_name: 'Lee', last_name: 'Park', email: 'lee@example.com' }, owner);
    await rt.actions.executeByName('customers.create', { company_name: 'Miller Property Management', is_property_manager: true }, owner);
    const ctx: ToolContext = { companyId: co, team: [] };
    const find = (query: string) => runReadTool(ctx, 'find_customer', { query }) as Promise<{ customer: string; can_text: boolean; can_email: boolean }[]>;
    expect(await find('pat')).toEqual([{ customer: 'Pat Miller', can_text: true, can_email: true }]);
    expect((await find('miller')).map((c) => c.customer).sort()).toEqual(['Miller Property Management', 'Pat Miller']);
    expect(await find('(512) 555-0147')).toHaveLength(1);
    expect((await find('lee@example.com'))[0]).toEqual({ customer: 'Lee Park', can_text: false, can_email: true });
    expect(JSON.stringify(await find('pat'))).not.toContain('5125550147');
    expect(await find('nobody here')).toEqual([]);
    await expect(find('a')).rejects.toThrow(/search for/);
    expect(HANDY_TOOLS.some((t) => t.function.name === 'find_customer')).toBe(true);
  });
});
