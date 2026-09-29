/**
 * Environment Configuration
 * Load and validate environment variables at startup
 */

import { logger } from './logger';

interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface PrinterConfig {
  ip: string;
  port: number;
  interface?: string;
  discoveryEnabled: boolean;
  discoveryTimeoutMs: number;
  discoveryPorts: number[];
}

interface AppConfig {
  env: 'development' | 'production' | 'test';
  name: string;
}

export interface Config {
  supabase: SupabaseConfig;
  printer: PrinterConfig;
  app: AppConfig;
}

/**
 * Validate and load environment variables
 */
function loadConfig(): Config {
  const missingVars: string[] = [];

  // Validate Supabase config
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) missingVars.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseAnonKey) missingVars.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!supabaseServiceRoleKey) missingVars.push('SUPABASE_SERVICE_ROLE_KEY');

  // Validate Printer config
  const printerIp = process.env.PRINTER_IP || '192.168.1.100';
  const printerPortStr = process.env.PRINTER_PORT || '9100';
  const printerInterface = process.env.PRINTER_INTERFACE?.trim();
  const printerDiscoveryEnabled = process.env.PRINTER_DISCOVERY_ENABLED !== 'false';
  const printerDiscoveryTimeoutMs = parseInt(
    process.env.PRINTER_DISCOVERY_TIMEOUT_MS || '5000',
    10
  );
  const printerDiscoveryPortsStr = process.env.PRINTER_DISCOVERY_PORTS || '9100,515,631';

  const printerPort = parseInt(printerPortStr, 10);
  if (isNaN(printerPort)) {
    missingVars.push('PRINTER_PORT (must be a valid number)');
  }

  const printerDiscoveryPorts = printerDiscoveryPortsStr
    .split(',')
    .map((p) => parseInt(p.trim(), 10))
    .filter((p) => !isNaN(p));

  if (printerDiscoveryPorts.length === 0) {
    missingVars.push('PRINTER_DISCOVERY_PORTS (must be comma-separated numbers)');
  }

  // Validate App config
  const appEnv = (process.env.APP_ENV || 'development') as
    | 'development'
    | 'production'
    | 'test';
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Port City Republic';

  if (missingVars.length > 0) {
    const errorMsg = `Missing required environment variables:\n${missingVars.map((v) => `  - ${v}`).join('\n')}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  const config: Config = {
    supabase: {
      url: supabaseUrl!,
      anonKey: supabaseAnonKey!,
      serviceRoleKey: supabaseServiceRoleKey!,
    },
    printer: {
      ip: printerIp,
      port: printerPort,
      interface: printerInterface || undefined,
      discoveryEnabled: printerDiscoveryEnabled,
      discoveryTimeoutMs: printerDiscoveryTimeoutMs,
      discoveryPorts: printerDiscoveryPorts,
    },
    app: {
      env: appEnv,
      name: appName,
    },
  };

  logger.info('Configuration loaded successfully', {
    app: config.app,
    printer: {
      ip: config.printer.ip,
      port: config.printer.port,
      interface: config.printer.interface,
      discoveryEnabled: config.printer.discoveryEnabled,
    },
  });

  return config;
}

let cachedConfig: Config | null = null;

/**
 * Get the application configuration
 * Config is cached after first load
 */
export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

// Load config at module import time for early validation
export const config = getConfig();
