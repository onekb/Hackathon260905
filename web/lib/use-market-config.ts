'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import { deployedConfig } from './contracts';
import { validateMarketConfig } from './assets';
import type { MarketConfig } from './types';

export function useMarketConfig() {
  const [config, setConfig] = useState<MarketConfig | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void api<MarketConfig>('/config', undefined, { signal: controller.signal }).then(value => {
      const valid = validateMarketConfig(value, deployedConfig.market_address);
      if (!controller.signal.aborted) setConfig(valid);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取市场配置。');
    });
    return () => controller.abort();
  }, []);
  return { config, error };
}
