'use client';

import { create } from 'zustand';

// We store the Web Serial Port reference here so it survives navigation.
// Zustand allows non-serializable objects if we are careful.

type PrinterStore = {
  port: any | null;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  printReceipts: (tickets: any[]) => Promise<boolean>;
};

function buildPrintData(ticket: any): Uint8Array {
  const ESC = '\x1B';
  const GS = '\x1D';
  const init = ESC + '@';
  const alignCenter = ESC + 'a' + '\x01';
  const alignLeft = ESC + 'a' + '\x00';
  const boldOn = ESC + 'E' + '\x01';
  const boldOff = ESC + 'E' + '\x00';
  const doubleHeight = ESC + '!' + '\x10';
  const normalSize = ESC + '!' + '\x00';
  const cut = GS + 'V' + '\x41' + '\x00'; // Full cut
  
  const line = '-'.repeat(48) + '\n';
  const heavyLine = '='.repeat(48) + '\n';

  const dateStr = new Date(ticket.created_at).toLocaleDateString('en-GB').replace(/\//g, '-');
  const timeStr = new Date(ticket.created_at).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });

  // Table padding generator
  const row = (label: string, value: string) => {
    const valStr = String(value);
    const space = 48 - label.length - valStr.length - 2; // 2 for padding around colon
    const padding = space > 0 ? ' '.repeat(space) : ' ';
    return `${label} :${padding}${valStr}\n`;
  };

  let data = init;
  data += alignCenter + "\n\n"; 
  data += boldOn + "PORT CITY REPUBLIC\n" + boldOff;
  data += heavyLine;
  data += boldOn + (ticket.activityName + " TOKEN\n").toUpperCase();
  data += normalSize + (ticket.token_number || 'N/A') + "\n";
  data += heavyLine + alignLeft;

  data += row('Activity', ticket.activityName);
  data += row('Date', dateStr);
  data += row('Time', timeStr);
  data += row('Cashier', ticket.cashierName);
  data += row('Token', `${ticket.token_index || 1} of ${ticket.token_total || 1}`);

  data += heavyLine + alignLeft;
  data += doubleHeight + boldOn;
  data += `Value  : Rs. ${Number(ticket.amount).toFixed(2)}\n`;
  data += normalSize + boldOff;
  data += `Txn No : ${ticket.txn_reference}\n`;
  data += heavyLine + alignCenter;
  data += "\nPlease surrender this token\n";
  data += "at the activity point.\n";
  data += "Cannot be reused.\n";
  data += "No Cash refund.\n";
  data += "\n\n\n\n\n\n" + cut;

  // We convert JS string to standard Windows-1252 / ASCII bytes. TextEncoder is UTF-8 but for generic English it works identically for ESC/POS.
  return new TextEncoder().encode(data);
}

export const useWebPrinterStore = create<PrinterStore>((set, get) => ({
  port: null,
  connect: async () => {
    const nav = navigator as any;
    if (!nav.serial) {
      alert('Your browser does not support Web Serial. Use Chrome, Edge, or Opera.');
      return false;
    }
    
    try {
      const p = await nav.serial.requestPort();
      await p.open({ baudRate: 9600 }); // Common default for generic receipt printers
      set({ port: p });
      return true;
    } catch (err) {
      console.error('Port selection failed:', err);
      return false;
    }
  },
  disconnect: async () => {
    const p = get().port;
    if (p) {
      try { await p.close(); } catch (e) {}
      set({ port: null });
    }
  },
  printReceipts: async (tickets: any[]) => {
    const p = get().port;
    if (!p) return false;
    
    if (!p.writable) {
      try {
        await p.open({ baudRate: 9600 });
      } catch (e) {
        console.error('Cannot open port:', e);
        return false;
      }
    }

    try {
      const writer = p.writable.getWriter();
      for (const t of tickets) {
        const bytes = buildPrintData(t);
        await writer.write(bytes);
      }
      writer.releaseLock();
      return true;
    } catch (err) {
      console.error('Print failed:', err);
      // Let's assume port crashed, clear it
      set({ port: null });
      return false;
    }
  }
}));
