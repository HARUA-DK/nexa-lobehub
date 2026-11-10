import { describe, expect, it, vi } from 'vitest';

const moduleEvaluation = vi.hoisted(() => ({
  defaultNamespace: vi.fn(),
  localizedNamespace: vi.fn(),
  testNamespace: vi.fn(),
}));

vi.mock('/packages/locales/src/default/common.ts', () => {
  moduleEvaluation.defaultNamespace();

  return { default: { source: 'default' } };
});

vi.mock('/locales/zh-CN/common.json', () => {
  moduleEvaluation.localizedNamespace();

  return { default: { source: 'localized' } };
});

vi.mock('/packages/locales/src/default/spend.test.ts', () => {
  moduleEvaluation.testNamespace();

  return { default: { source: 'test-only' } };
});

describe('loadI18nNamespaceModule.desktop', () => {
  it('evaluates only the requested locale namespace', async () => {
    const { loadI18nNamespaceModule } = await import('./loadI18nNamespaceModule.desktop');

    expect(moduleEvaluation.defaultNamespace).not.toHaveBeenCalled();
    expect(moduleEvaluation.localizedNamespace).not.toHaveBeenCalled();

    const result = await loadI18nNamespaceModule({
      defaultLang: 'en-US',
      lng: 'zh-CN',
      normalizeLocale: (locale) => locale ?? 'en-US',
      ns: 'common',
    });

    expect(result.default).toEqual({ source: 'localized' });
    expect(moduleEvaluation.localizedNamespace).toHaveBeenCalledOnce();
    expect(moduleEvaluation.defaultNamespace).not.toHaveBeenCalled();
  });

  it.each(['en-US', 'zh-CN'])('does not expose test files as namespaces for %s', async (lng) => {
    const { loadI18nNamespaceModule, loadI18nNamespaceModuleWithFallback } = await import(
      './loadI18nNamespaceModule.desktop'
    );
    const params = {
      defaultLang: 'en-US',
      lng,
      normalizeLocale: (locale?: string) => locale ?? 'en-US',
      ns: 'spend.test',
    };

    await expect(loadI18nNamespaceModule(params)).rejects.toThrow(
      'Missing default namespace: spend.test',
    );
    await expect(loadI18nNamespaceModuleWithFallback(params)).rejects.toThrow(
      'Missing default namespace: spend.test',
    );
    expect(moduleEvaluation.testNamespace).not.toHaveBeenCalled();
  });
});
