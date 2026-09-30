import { formatInTimeZone } from 'date-fns-tz';
import {
  BreakLine,
  CharacterSet,
  PrinterTypes,
  ThermalPrinter,
} from 'node-thermal-printer';

import { config } from '@/lib/config';
import { PrintError } from '@/lib/errors';

type PrintTarget = {
  ip?: string;
  port?: number;
  interface?: string;
};

export type TicketPayload = {
  tokenNumber: string;
  activityName: string;
  amount: number;
  transactionNumber: string;
  cashierName: string;
  tokenIndex: number;
  tokenTotal: number;
  transactionCreatedAt: string;
  isExchanged?: boolean;
};

const queue = {
  current: Promise.resolve(),
};

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.current.then(work);
  queue.current = next.then(() => undefined).catch(() => undefined);
  return next;
}

function formatCurrency(value: number): string {
  const formatter = new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `Rs. ${formatter.format(value)}`;
}

function buildTicket(printer: ThermalPrinter, payload: TicketPayload) {
  const createdAt = new Date(payload.transactionCreatedAt);
  const ticketDate = formatInTimeZone(createdAt, 'Asia/Colombo', 'dd-MM-yyyy');
  const ticketTime = formatInTimeZone(createdAt, 'Asia/Colombo', 'hh:mm:ss a');

  printer.alignCenter();
  printer.bold(true);
  printer.println('PORT CITY REPUBLIC');
  printer.bold(false);
  printer.println('Hotline: 0776569718');

  printer.drawLine('=');
  printer.bold(true);
  printer.println('ACTIVITY TOKEN');
  if (payload.isExchanged) {
    printer.println('** EXCHANGED **');
  }
  printer.bold(false);
  printer.println(payload.tokenNumber);
  printer.drawLine('=');

  printer.tableCustom([
    { text: 'Activity', align: 'LEFT', width: 0.38 },
    { text: payload.activityName, align: 'RIGHT', width: 0.62 },
  ]);
  printer.tableCustom([
    { text: 'Date', align: 'LEFT', width: 0.38 },
    { text: ticketDate, align: 'RIGHT', width: 0.62 },
  ]);
  printer.tableCustom([
    { text: 'Time', align: 'LEFT', width: 0.38 },
    { text: ticketTime.toUpperCase(), align: 'RIGHT', width: 0.62 },
  ]);
  printer.tableCustom([
    { text: 'Cashier', align: 'LEFT', width: 0.38 },
    { text: payload.cashierName, align: 'RIGHT', width: 0.62 },
  ]);
  printer.tableCustom([
    { text: 'Token', align: 'LEFT', width: 0.38 },
    {
      text: `${payload.tokenIndex} of ${payload.tokenTotal}`,
      align: 'RIGHT',
      width: 0.62,
    },
  ]);

  printer.drawLine('=');
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(`Value  : ${formatCurrency(payload.amount)}`);
  printer.setTextNormal();
  printer.bold(false);
  printer.println(`Txn No : ${payload.transactionNumber}`);
  printer.drawLine('=');

  printer.alignCenter();
  printer.println('Please surrender this token');
  printer.println('at the activity point.');
  printer.println('Cannot be reused.');
  printer.println('No Cash refund.');
  printer.newLine();
  printer.println('The organizers shall not be held liable');
  printer.println('for any loss, damage to property, or');
  printer.println('personal injury sustained on the premises.');
  printer.newLine();
  printer.cut();
}

export async function printActivityTicket(input: {
  target: PrintTarget;
  payload: TicketPayload;
  transactionId: string;
}) {
  return enqueue(async () => {
    const printerInterface =
      input.target.interface ??
      (input.target.ip && input.target.port
        ? `tcp://${input.target.ip}:${input.target.port}`
        : null);

    if (!printerInterface) {
      throw new PrintError('Invalid printer target', input.transactionId, {
        targetIp: input.target.ip,
        targetPort: input.target.port,
        targetInterface: input.target.interface,
      });
    }

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: printerInterface,
      width: 48,
      characterSet: CharacterSet.WPC1252,
      breakLine: BreakLine.WORD,
      removeSpecialCharacters: false,
      options: {
        timeout: config.printer.discoveryTimeoutMs,
      },
    });

    if (printerInterface.startsWith('tcp://')) {
      const isConnected = await printer.isPrinterConnected();
      if (!isConnected) {
        throw new PrintError('Printer is offline', input.transactionId, {
          targetIp: input.target.ip,
          targetPort: input.target.port,
          targetInterface: printerInterface,
        });
      }
    }

    buildTicket(printer, input.payload);

    try {
      await printer.execute();
    } catch (error) {
      throw new PrintError('Failed to execute print job', input.transactionId, {
        targetIp: input.target.ip,
        targetPort: input.target.port,
        targetInterface: printerInterface,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      printedAt: new Date().toISOString(),
      target: input.target,
    };
  });
}
