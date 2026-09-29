'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatColomboDate } from '@/lib/dateUtils';
import { useNotificationsStore } from '@/stores/notifications';
import type { PriceType } from '@/types/transaction';

export type PrintedTicket = {
  id: string;
  token_number?: string | null;
  token_index?: number | null;
  token_total?: number | null;
  price_type: PriceType;
  amount: number;
  activityName: string;
  cashierName: string;
  created_at: string;
  txn_reference: string;
};

type TicketPreviewProps = {
  open: boolean;
  tickets: PrintedTicket[];
  onClose: () => void;
};

export default function TicketPreview({ open, tickets, onClose }: TicketPreviewProps) {
  const pushNotification = useNotificationsStore((state) => state.push);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printerInterface, setPrinterInterface] = useState<string>('');

  useEffect(() => {
    const saved = localStorage.getItem('carnival-printer-interface');
    if (saved) {
      setPrinterInterface(saved);
    }
  }, []);

  const handleInterfaceChange = (value: string) => {
    setPrinterInterface(value);
    localStorage.setItem('carnival-printer-interface', value);
  };

  if (!open || tickets.length === 0) {
    return null;
  }

  const handleDirectPrint = async () => {
    const normalizedInterface = printerInterface.trim();

    if (!normalizedInterface) {
      pushNotification({
        type: 'warning',
        title: 'Printer Interface Required',
        message: 'Enter USB COM interface like \\\\.\\COM3 (check Device Manager > Ports).',
      });
      return;
    }

    setIsPrinting(true);
    let successCount = 0;

    try {
      for (const ticket of tickets) {
        const response = await fetch('/api/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_id: ticket.id,
            targetInterface: normalizedInterface,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to print token ' + (ticket.token_number || '-'));
        }
        successCount++;
        // Small delay between prints to avoid overwhelming buffer
        await new Promise((r) => setTimeout(r, 300));
      }

      pushNotification({
        type: 'success',
        title: 'Printed Successfully',
        message: `Printed ${successCount} tickets to ${normalizedInterface}`,
      });
      onClose();
    } catch (e: any) {
      pushNotification({
        type: 'error',
        title: 'Direct Print Failed',
        message: e.message || 'Could not send to printer. Check printer interface and Windows printer setup.',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div id="ticket-preview-portal" className="preview-modal-overlay fixed inset-0 z-[100] flex flex-col items-center overflow-y-auto bg-slate-950/80 px-4 py-8 sm:py-12">
      <div className="mb-6 flex w-full max-w-4xl items-center justify-between no-print">
        <h2 className="text-2xl font-bold text-white">Visual Receipt Preview ({tickets.length})</h2>
        <div className="flex items-center gap-4">
        
        <div className="flex flex-col gap-1 items-end">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-widest">PRINTER INTERFACE</label>
          <input 
            type="text" 
            placeholder="USB COM port e.g. \\\\.\\COM3" 
            value={printerInterface}
            onChange={(e) => handleInterfaceChange(e.target.value)}
            className="h-10 w-64 rounded-md border-2 border-slate-600 bg-slate-800 px-3 text-sm font-semibold text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
          />
        </div>

        <Button 
          onClick={handleDirectPrint} 
          disabled={isPrinting}
          className="shadow-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white h-10 px-6 mt-5"
        >
          {isPrinting ? 'Printing...' : 'Print Directly'}
        </Button>

        <div className="h-8 w-px bg-slate-700 mx-2 mt-5"></div>

        <Button 
          onClick={() => { window.print(); onClose(); }} 
          variant="outline" 
          disabled={isPrinting}
          className="shadow-sm font-bold text-slate-900 border-2 border-slate-300 bg-white h-10 px-4 mt-5"
        >
          Browser Print
        </Button>
        <Button onClick={onClose} variant="secondary" className="shadow-sm font-semibold text-slate-900 h-10 px-4 mt-5">
          Close Preview
        </Button>
        </div>
      </div>

      <div id="printable-tickets" className="flex w-full max-w-4xl flex-wrap justify-center gap-6 pb-20">
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            className="ticket-print-container flex flex-col items-center bg-white fill-white shadow-2xl relative"
            style={{ width: '80mm', fontFamily: 'monospace', paddingBottom: '10mm', paddingTop: '10mm' }}
          >
            <div className="w-full flex flex-col items-center p-4 pb-8 text-black relative z-10" style={{ maxWidth: '80mm' }}>
              {/* Logo */}
              <div className="mb-0 mt-9 flex w-full flex-col items-center justify-center">
                <Image
                  src="/logo/logo.png"
                  alt="Port City Republic"
                  width={220}
                  height={100}
                  className="h-auto w-full max-w-[220px] object-contain grayscale"
                />
              </div>

              {/* Hotline */}
              <div className="text-center font-bold text-[12px] mb-4 tracking-tight w-full">
                Hotline: 0776569718
              </div>

              {/* Dashed Separator */}
              <div className="w-full border-b-[2px] border-dashed border-black mb-4"></div>

              {/* Title Section */}
              <div className="text-center font-bold tracking-widest text-[16px] uppercase leading-tight w-full truncate">
                {ticket.activityName} TOKEN
              </div>
              <div className="text-center font-bold text-[14px] mt-1 tracking-widest">
                {ticket.token_number || 'N/A'}
              </div>

              <div className="w-full border-b-[2px] border-dashed border-black my-4"></div>

              {/* Details Details */}
              <div className="w-full text-left text-[14px] font-semibold leading-[1.6] px-1">
                <div className="flex w-full whitespace-nowrap">
                  <span className="w-16">Date</span>
                  <span className="mr-2">:</span>
                  <span className="truncate">
                    {formatColomboDate(new Date(ticket.created_at))}
                  </span>
                </div>
                <div className="flex w-full whitespace-nowrap">
                  <span className="w-16">Time</span>
                  <span className="mr-2">:</span>
                  <span className="truncate">
                    {formatColomboDate(new Date(ticket.created_at), 'hh:mm:ss a')}
                  </span>
                </div>
                <div className="flex w-full whitespace-nowrap">
                  <span className="w-16">Token</span>
                  <span className="mr-2">:</span>
                  <span>{ticket.token_index || 1} of {ticket.token_total || 1}</span>
                </div>
                <div className="flex w-full whitespace-nowrap">
                  <span className="w-16">Cashier</span>
                  <span className="mr-2">:</span>
                  <span className="truncate">{ticket.cashierName}</span>
                </div>
              </div>

              {/* Value Line */}
              <div className="w-full flex items-center justify-start mt-6 mb-2 px-1">
                <span className="text-[24px] font-bold tracking-tight">Value</span>
                <span className="mx-2 text-[20px] font-bold">:</span>
                <span className="text-[22px] font-bold tracking-tight">Rs. {ticket.amount.toFixed(2)}</span>
              </div>

              {/* Txn No */}
              {/* <div className="w-full text-left text-[10px] font-bold mt-1 px-1 tracking-tight truncate">
                Txn No : {ticket.txn_reference}
              </div> */}

              <div className="w-full border-b-[2px] border-dashed border-black mt-2 mb-4"></div>

              {/* Footer Text */}
              <div className="text-center text-[10px] font-bold leading-[1.4] mt-2 mb-6 px-2 tracking-tight">
                {/* Please surrender this token<br />
                at the activity point.<br />
                Cannot be reused. No cash refund.<br />
                <br /> */}
                <span className="text-[9px] font-bold leading-tight block px-1">
                  The organizers shall not be held liable for any loss, damage to property, or personal injury sustained on the premises.
                </span>
                <br />
                <br />
                {/* Dashed Separator */}
              <div className="w-full border-b-[2px] border-dashed border-black mb-4"></div>
              <br />
                <br />
                {/* Dashed Separator */}
              <div className="w-full border-b-[2px] border-dashed border-blue mb-6"></div>
              </div>
            </div>
            
            {/* Ragged bottom paper effect wrapper */}
          </div>
        ))}
      </div>
    </div>
  );
}
