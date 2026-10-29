import Link from "next/link";
import { notFound } from "next/navigation";
import { getSafeguardRecord } from "@/lib/service";
import { SafeguardRecordView } from "@/components/safeguard-record";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

/** One Safeguard Record, rendered as its full causal chain. */
export default async function RecordDetailPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  let record;
  try {
    record = await getSafeguardRecord(recordId);
  } catch (err) {
    return (
      <Notice tone="bad" title="The record store could not be read">
        {(err as Error).message}
      </Notice>
    );
  }
  if (!record) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/records"
        className="mono text-[0.6875rem] text-signal-info underline-offset-2 hover:underline"
      >
        ← All records
      </Link>
      <h1 className="sr-only">Safeguard Record {record.recordId.slice(0, 8)}</h1>
      <SafeguardRecordView record={record} />
    </div>
  );
}
