import {X509Certificate} from 'node:crypto';

const caUrl='https://supabase-downloads.s3.amazonaws.com/prod/ssl/prod-ca-2021.crt';
// Public Supabase Root 2021 CA, obtained over verified HTTPS. Fail closed on CA rotation.
const caFingerprint='80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';
export async function maintenanceConnection(env,projectRef,fetcher=fetch){
  if(!/^[a-z]{20}$/.test(projectRef)||!env.SUPABASE_DB_PASSWORD)throw new Error('Valid Supabase project and database password required');
  const pooler=env.SUPABASE_DB_POOLER_HOST;
  if(pooler&&!/^aws-\d+-[a-z]+-[a-z]+-\d\.pooler\.supabase\.com$/.test(pooler))throw new Error('Use the official Supabase session pooler hostname');
  const response=await fetcher(caUrl,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new Error('Could not download the public Supabase CA');
  const ca=await response.text(),certificate=new X509Certificate(ca);
  if(certificate.fingerprint256!==caFingerprint)throw new Error('Supabase CA changed; review the certificate before continuing');
  return {host:pooler||`db.${projectRef}.supabase.co`,port:5432,user:pooler?`postgres.${projectRef}`:'postgres',password:env.SUPABASE_DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:true,ca},connectionTimeoutMillis:15000};
}
