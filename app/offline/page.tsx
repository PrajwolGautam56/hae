import Image from "next/image";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <Image src="/icons/icon-192.png" width={52} height={52} alt="Hamro Afno Enterprises" />
          <div><strong>Hamro Afno Enterprises</strong><span>Accounts · Inventory · CRM</span></div>
        </div>
        <div className="login-copy">
          <small>YOU ARE OFFLINE</small>
          <h1>Internet connection चाहिन्छ</h1>
          <p>Accounting data सुरक्षित राख्न यो appले offline transaction save गर्दैन। Internet जोडिएपछि फेरि खोल्नुहोस्।</p>
        </div>
        <Link href="/">Try again</Link>
      </section>
    </main>
  );
}
