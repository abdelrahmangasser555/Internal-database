import { resolveConnection } from './adapters/index.js';
import { insightHistory, recordInsightSample } from './store.js';

const DAY = 86_400_000;

const REGIONS = {
  'us-east-1': { country: 'United States', flag: '🇺🇸', city: 'N. Virginia', provider: 'AWS' },
  'us-east-2': { country: 'United States', flag: '🇺🇸', city: 'Ohio', provider: 'AWS' },
  'us-west-1': { country: 'United States', flag: '🇺🇸', city: 'N. California', provider: 'AWS' },
  'us-west-2': { country: 'United States', flag: '🇺🇸', city: 'Oregon', provider: 'AWS' },
  'ca-central-1': { country: 'Canada', flag: '🇨🇦', city: 'Montreal', provider: 'AWS' },
  'sa-east-1': { country: 'Brazil', flag: '🇧🇷', city: 'São Paulo', provider: 'AWS' },
  'eu-west-1': { country: 'Ireland', flag: '🇮🇪', city: 'Dublin', provider: 'AWS' },
  'eu-west-2': { country: 'United Kingdom', flag: '🇬🇧', city: 'London', provider: 'AWS' },
  'eu-west-3': { country: 'France', flag: '🇫🇷', city: 'Paris', provider: 'AWS' },
  'eu-central-1': { country: 'Germany', flag: '🇩🇪', city: 'Frankfurt', provider: 'AWS' },
  'eu-north-1': { country: 'Sweden', flag: '🇸🇪', city: 'Stockholm', provider: 'AWS' },
  'eu-south-1': { country: 'Italy', flag: '🇮🇹', city: 'Milan', provider: 'AWS' },
  'ap-southeast-1': { country: 'Singapore', flag: '🇸🇬', city: 'Singapore', provider: 'AWS' },
  'ap-southeast-2': { country: 'Australia', flag: '🇦🇺', city: 'Sydney', provider: 'AWS' },
  'ap-northeast-1': { country: 'Japan', flag: '🇯🇵', city: 'Tokyo', provider: 'AWS' },
  'ap-northeast-2': { country: 'South Korea', flag: '🇰🇷', city: 'Seoul', provider: 'AWS' },
  'ap-south-1': { country: 'India', flag: '🇮🇳', city: 'Mumbai', provider: 'AWS' },
  'ap-east-1': { country: 'Hong Kong', flag: '🇭🇰', city: 'Hong Kong', provider: 'AWS' },
  'me-central-1': { country: 'United Arab Emirates', flag: '🇦🇪', city: 'UAE', provider: 'AWS' },
  'me-south-1': { country: 'Bahrain', flag: '🇧🇭', city: 'Bahrain', provider: 'AWS' },
  'af-south-1': { country: 'South Africa', flag: '🇿🇦', city: 'Cape Town', provider: 'AWS' },
  'us-central1': { country: 'United States', flag: '🇺🇸', city: 'Iowa', provider: 'GCP' },
  'us-east1': { country: 'United States', flag: '🇺🇸', city: 'S. Carolina', provider: 'GCP' },
  'europe-west1': { country: 'Belgium', flag: '🇧🇪', city: 'St. Ghislain', provider: 'GCP' },
  'europe-west2': { country: 'United Kingdom', flag: '🇬🇧', city: 'London', provider: 'GCP' },
  'europe-west3': { country: 'Germany', flag: '🇩🇪', city: 'Frankfurt', provider: 'GCP' },
  'europe-west4': { country: 'Netherlands', flag: '🇳🇱', city: 'Eemshaven', provider: 'GCP' },
  'asia-east1': { country: 'Taiwan', flag: '🇹🇼', city: 'Taiwan', provider: 'GCP' },
  'asia-northeast1': { country: 'Japan', flag: '🇯🇵', city: 'Tokyo', provider: 'GCP' },
  'asia-south1': { country: 'India', flag: '🇮🇳', city: 'Mumbai', provider: 'GCP' },
  'asia-southeast1': { country: 'Singapore', flag: '🇸🇬', city: 'Singapore', provider: 'GCP' },
  'australia-southeast1': { country: 'Australia', flag: '🇦🇺', city: 'Sydney', provider: 'GCP' },
  eastus: { country: 'United States', flag: '🇺🇸', city: 'Virginia', provider: 'Azure' },
  eastus2: { country: 'United States', flag: '🇺🇸', city: 'Virginia', provider: 'Azure' },
  westus: { country: 'United States', flag: '🇺🇸', city: 'California', provider: 'Azure' },
  westus2: { country: 'United States', flag: '🇺🇸', city: 'Washington', provider: 'Azure' },
  westeurope: { country: 'Netherlands', flag: '🇳🇱', city: 'Netherlands', provider: 'Azure' },
  northeurope: { country: 'Ireland', flag: '🇮🇪', city: 'Ireland', provider: 'Azure' },
  germanywestcentral: { country: 'Germany', flag: '🇩🇪', city: 'Frankfurt', provider: 'Azure' },
  uksouth: { country: 'United Kingdom', flag: '🇬🇧', city: 'London', provider: 'Azure' },
  southeastasia: { country: 'Singapore', flag: '🇸🇬', city: 'Singapore', provider: 'Azure' },
  japaneast: { country: 'Japan', flag: '🇯🇵', city: 'Tokyo', provider: 'Azure' },
};

export function describeRegion(tag) {
  if (!tag) return null;
  let raw = String(tag).trim();
  const providerHint = /gcp|google/i.test(raw) ? 'GCP' : /azure/i.test(raw) ? 'Azure' : /aws|amazon/i.test(raw) ? 'AWS' : null;
  raw = raw.replace(/^(AWS_|GCP_|AZURE_|AZURE)/i, '');
  const key = raw.replace(/_/g, '-').toLowerCase();
  const hit = REGIONS[key] || REGIONS[key.replace(/-\d+$/, (m, offset, s) => (s.includes('europe') || s.includes('us-') ? m : m))];
  if (hit) return { ...hit, code: raw, provider: hit.provider || providerHint };
  return { country: raw, flag: '', city: '', provider: providerHint || '', code: raw };
}

function periodDelta(history) {
  const now = Date.now();
  const window = history.filter((s) => s.at && now - new Date(s.at).getTime() <= DAY);
  const list = window.length >= 2 ? window : history;
  if (list.length < 2) return { opened: null, samples: history.length, from: history[0]?.at || null, to: history.at?.(-1)?.at || null };
  const first = list[0];
  const last = list[list.length - 1];
  const opened =
    first.totalCreated != null && last.totalCreated != null ? Math.max(0, Number(last.totalCreated) - Number(first.totalCreated)) : null;
  return { opened, samples: list.length, from: first.at, to: last.at, windowHours: 24 };
}

export async function connectionInsight(connectionId, database) {
  const { conn, adapter, info } = resolveConnection(connectionId);
  if (typeof adapter.insight !== 'function') {
    return {
      engine: conn.engine,
      label: info.label,
      name: conn.name,
      environment: conn.environment,
      notes: ['This engine does not report live cluster metadata.'],
    };
  }
  const started = Date.now();
  const raw = await adapter.insight(conn, database);
  const insight = {
    engine: conn.engine,
    label: info.label,
    name: conn.name,
    environment: conn.environment,
    uriMasked: conn.uriMasked,
    latencyMs: Date.now() - started,
    ...raw,
  };
  if (insight.regionCode && !insight.region) insight.region = describeRegion(insight.regionCode);
  if (Array.isArray(insight.members)) {
    insight.members = insight.members.map((m) => ({
      ...m,
      region: m.regionCode ? describeRegion(m.regionCode) : m.region || null,
    }));
    const withRegion = insight.members.find((m) => m.region);
    if (!insight.region && withRegion) insight.region = withRegion.region;
  }
  const history = recordInsightSample(connectionId, {
    connectionsCurrent: insight.connections?.current ?? null,
    totalCreated: insight.connections?.totalCreated ?? null,
    databases: insight.databases?.length ?? null,
  });
  insight.history = periodDelta(history);
  return insight;
}
