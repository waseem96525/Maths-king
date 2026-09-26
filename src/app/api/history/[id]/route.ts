import { NextResponse } from 'next/server';

import { getStore } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/history/[id] — remove one stored problem.
 *
 * The store reports whether a row was actually there, so a request for an id
 * that never existed is a 404 rather than a misleading success.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);

  // `Number` accepts "1e3" and " 2 ", neither of which is an id anyone means.
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(numeric) || numeric < 1) {
    return NextResponse.json({ error: 'Expected a positive integer id.' }, { status: 400 });
  }

  const store = getStore();
  if (!store.available) {
    return NextResponse.json({ available: false, reason: store.reason }, { status: 503 });
  }
  if (!store.delete(numeric)) {
    return NextResponse.json({ error: `No problem with id ${numeric}.` }, { status: 404 });
  }
  return NextResponse.json({ available: true, deleted: 1, id: numeric });
}
