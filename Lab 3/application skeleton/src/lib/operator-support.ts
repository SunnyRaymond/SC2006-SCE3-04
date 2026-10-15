// Official support pages checked on 15 October 2026; unknown operators have no inferred URL.
export function operatorSupportUrl(operator: string): string | null {
  const name = operator.toUpperCase().replace(/[^A-Z0-9+]/g, '');
  if (name.includes('SPMOBILITY') || name.includes('SPGROUP')) return 'https://www.spmobility.sg/support';
  if (name.includes('CHARGE+') || name.includes('CHARGEPLUS')) return 'https://www.chargeplus.com/services-3';
  if (name.includes('COMFORTDELGRO') || name.includes('CDGENGIE') || name.includes('CDGENERGY')) return 'https://support.cdgengie.com/hc/en-us';
  if (name.includes('SHELL')) return 'https://www.shell.com.sg/contact-us.html';
  if ((name.includes('VOLTSINGAPORE') || name.startsWith('KEPPELVOLT'))) return 'https://www.keppelvolt.com/faq/drivers/';
  return null;
}
