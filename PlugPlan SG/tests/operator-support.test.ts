import { expect, it } from 'vitest';
import { operatorSupportUrl } from '../src/lib/operator-support';

it('links known LTA operator labels to official support and leaves unknown operators unlinked', () => {
  expect(operatorSupportUrl('SP MOBILITY PTE. LTD.')).toBe('https://www.spmobility.sg/support');
  expect(operatorSupportUrl('CHARGE+ PTE. LTD.')).toBe('https://www.chargeplus.com/services-3');
  expect(operatorSupportUrl('COMFORTDELGRO ENGIE PTE. LTD.')).toBe('https://support.cdgengie.com/hc/en-us');
  expect(operatorSupportUrl('SHELL SINGAPORE PTE. LTD.')).toBe('https://www.shell.com.sg/contact-us.html');
  expect(operatorSupportUrl('VOLT SINGAPORE PTE. LTD.')).toBe('https://www.keppelvolt.com/faq/drivers/');
  expect(operatorSupportUrl('DEMO_FIXTURE')).toBeNull();
  expect(operatorSupportUrl('javascript:alert(1)')).toBeNull();
});
