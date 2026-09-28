import { describe, expect, it } from 'vitest';
import {
  describeCpu,
  describeOsFromHints,
  hasChromiumBrand,
  macOsName,
  parseUserAgent,
  pickBrand,
} from '../../src/render/capabilities/environment';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  firefoxWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.3400.12',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.7000.1 Mobile/15E148 Safari/604.1',
};

describe('client hints', () => {
  it('names the real macOS version (UA strings freeze it at 10.15.7)', () => {
    expect(describeOsFromHints('macOS', '12.7.6').label).toBe('macOS 12.7.6 (Monterey)');
    expect(describeOsFromHints('macOS', '13.7.1').label).toBe('macOS 13.7.1 (Ventura)');
    expect(describeOsFromHints('macOS', '26.0.1').label).toBe('macOS 26.0.1 (Tahoe)');
    expect(describeOsFromHints('macOS', '27.0.0').label).toBe('macOS 27.0.0');
    expect(describeOsFromHints('macOS', '').label).toBe('macOS');
    expect(macOsName('10.15.7')).toBe('Catalina');
  });

  it('tells Windows 11 from Windows 10 by platform version', () => {
    expect(describeOsFromHints('Windows', '19.0.0').label).toBe(
      'Windows 11 (platform version 19.0.0)',
    );
    expect(describeOsFromHints('Windows', '13.0.0').label).toContain('Windows 11');
    expect(describeOsFromHints('Windows', '10.0.0').label).toContain('Windows 10');
    expect(describeOsFromHints('Windows', '0.3.0').label).toContain('Windows 7, 8 or 8.1');
    expect(describeOsFromHints('Linux', '').label).toBe('Linux');
  });

  it('says Intel or Apple Silicon on a Mac', () => {
    expect(describeCpu('x86', '64', 'macOS', 4).label).toBe('Intel (x86, 64-bit)');
    expect(describeCpu('arm', '64', 'macOS', 8).label).toBe('Apple Silicon (arm, 64-bit)');
    expect(describeCpu('x86', '64', 'Windows', 12).label).toBe('x86, 64-bit');
    expect(describeCpu(null, null, 'Unknown', null).label).toBe('unknown architecture');
  });

  it('picks the most specific brand and skips GREASE brands', () => {
    const brands = [
      { brand: 'Not_A Brand', version: '8.0.0.0' },
      { brand: 'Chromium', version: '153.0.8010.53' },
      { brand: 'Google Chrome', version: '153.0.8010.53' },
    ];
    expect(pickBrand(brands)).toEqual({ brand: 'Google Chrome', version: '153.0.8010.53' });
    expect(
      pickBrand([
        { brand: 'Not)A;Brand', version: '99' },
        { brand: 'Chromium', version: '1' },
      ]),
    ).toEqual({ brand: 'Chromium', version: '1' });
    expect(pickBrand([{ brand: 'Not A(Brand', version: '99' }])).toBeNull();
    expect(hasChromiumBrand(brands)).toBe(true);
    expect(hasChromiumBrand([{ brand: 'Not A(Brand', version: '99' }])).toBe(false);
    expect(hasChromiumBrand(undefined)).toBe(false);
  });
});

describe('user-agent fallback (Safari, Firefox)', () => {
  it('recognises Safari on a Mac as not Chromium, with the frozen version flagged', () => {
    const { browser, os } = parseUserAgent(UA.safariMac);
    expect(browser).toEqual({ name: 'Safari', version: '19.0', isChromium: false });
    expect(os.name).toBe('macOS');
    expect(os.label).toContain('10.15.7');
    expect(os.label).toContain('freeze');
    expect(os.source).toBe('user-agent');
  });

  it('recognises Firefox, Chrome, Edge and Chrome on iOS', () => {
    expect(parseUserAgent(UA.firefoxWindows).browser).toEqual({
      name: 'Firefox',
      version: '143.0',
      isChromium: false,
    });
    expect(parseUserAgent(UA.firefoxWindows).os.label).toBe('Windows 10 or 11 (NT 10.0)');
    expect(parseUserAgent(UA.chromeMac).browser).toEqual({
      name: 'Google Chrome',
      version: '150.0.0.0',
      isChromium: true,
    });
    expect(parseUserAgent(UA.edgeWindows).browser.name).toBe('Microsoft Edge');
    expect(parseUserAgent(UA.edgeWindows).browser.isChromium).toBe(true);
    const ios = parseUserAgent(UA.chromeIos);
    expect(ios.browser.isChromium).toBe(false);
    expect(ios.os).toMatchObject({ name: 'iOS', version: '19.0' });
  });
});
