import { RemoteDoc } from "@/lib/db";
import { run, sshCommand } from "@/lib/mounts";

/** one POSIX sh script that prints key=value facts; every probe is best effort */
const PROBE = String.raw`
echo "hostname=$(hostname 2>/dev/null)"
echo "os=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s)"
echo "kernel=$(uname -r)"
echo "arch=$(uname -m)"
[ -r /proc/uptime ] && echo "uptime=$(cut -d' ' -f1 /proc/uptime)"
[ -r /proc/loadavg ] && echo "load=$(cut -d' ' -f1-3 /proc/loadavg)"
echo "cpus=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null)"
[ -r /proc/meminfo ] && awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}/^SwapTotal:/{st=$2}/^SwapFree:/{sf=$2}END{print "mem_total="t*1024; print "mem_avail="a*1024; print "swap_total="st*1024; print "swap_free="sf*1024}' /proc/meminfo
df -PkT -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null | awk 'NR>1 && $3>0 {print "disk="$7"|"$3*1024"|"$4*1024}'
[ -f /var/run/reboot-required ] && echo "reboot=1"
if command -v docker >/dev/null 2>&1; then echo "docker=$(docker ps -q 2>/dev/null | wc -l)/$(docker ps -aq 2>/dev/null | wc -l)"; fi
if command -v systemctl >/dev/null 2>&1; then echo "failed_units=$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | paste -sd, -)"; fi
if [ -x /usr/lib/update-notifier/apt-check ]; then echo "updates=$(/usr/lib/update-notifier/apt-check 2>&1)";
elif command -v apt-get >/dev/null 2>&1; then echo "updates=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c ^Inst)";
elif command -v dnf >/dev/null 2>&1; then echo "updates=$(dnf -q check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')";
elif command -v apk >/dev/null 2>&1; then echo "updates=$(apk -u list 2>/dev/null | wc -l)"; fi
`;

export interface HostHealth {
  remoteId: string;
  name: string;
  host: string;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  hostname?: string;
  os?: string;
  kernel?: string;
  arch?: string;
  uptimeSec?: number;
  load?: [number, number, number];
  cpus?: number;
  memTotal?: number;
  memAvail?: number;
  swapTotal?: number;
  swapFree?: number;
  disks?: { mount: string; total: number; used: number }[];
  rebootRequired?: boolean;
  docker?: { running: number; total: number } | null;
  failedUnits?: string[];
  updates?: number | null;
  securityUpdates?: number | null;
  checkedAt: string;
}

function parse(out: string, base: HostHealth): HostHealth {
  const h = { ...base, disks: [] as NonNullable<HostHealth["disks"]> };
  for (const line of out.split("\n")) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1).trim();
    const num = Number(v);
    switch (k) {
      case "hostname":
        h.hostname = v;
        break;
      case "os":
        h.os = v;
        break;
      case "kernel":
        h.kernel = v;
        break;
      case "arch":
        h.arch = v;
        break;
      case "uptime":
        h.uptimeSec = num;
        break;
      case "load": {
        const [a, b, c] = v.split(/\s+/).map(Number);
        h.load = [a, b, c];
        break;
      }
      case "cpus":
        h.cpus = num || undefined;
        break;
      case "mem_total":
        h.memTotal = num;
        break;
      case "mem_avail":
        h.memAvail = num;
        break;
      case "swap_total":
        h.swapTotal = num;
        break;
      case "swap_free":
        h.swapFree = num;
        break;
      case "disk": {
        const [mount, total, used] = v.split("|");
        if (!h.disks.some((d) => d.mount === mount))
          h.disks.push({ mount, total: Number(total), used: Number(used) });
        break;
      }
      case "reboot":
        h.rebootRequired = true;
        break;
      case "docker": {
        const [r, t] = v.split("/").map(Number);
        h.docker = { running: r || 0, total: t || 0 };
        break;
      }
      case "failed_units":
        h.failedUnits = v ? v.split(",").filter(Boolean) : [];
        break;
      case "updates": {
        // apt-check prints "12;3" (all;security)
        const [all, sec] = v.split(";");
        h.updates = Number.isFinite(Number(all)) ? Number(all) : null;
        h.securityUpdates = sec !== undefined && Number.isFinite(Number(sec)) ? Number(sec) : null;
        break;
      }
    }
  }
  return h;
}

export async function probeHost(r: RemoteDoc): Promise<HostHealth> {
  const base: HostHealth = {
    remoteId: r._id.toHexString(),
    name: r.name,
    host: r.host,
    ok: false,
    checkedAt: new Date().toISOString(),
  };
  const started = Date.now();
  try {
    const c = await sshCommand(r, "sh -s");
    const { stdout } = await run(c.cmd, c.args, { env: c.env, input: PROBE, timeout: 30000 }).catch((e) => {
      // the probe itself never fails; a non-zero exit with output still has facts
      if (/=/.test(e.message) && /hostname=/.test(e.message)) return { stdout: e.message, stderr: "" };
      throw e;
    });
    return parse(stdout, { ...base, ok: true, latencyMs: Date.now() - started });
  } catch (e: any) {
    return { ...base, error: (e?.message || String(e)).trim().slice(0, 500), latencyMs: Date.now() - started };
  }
}

/** probe many hosts with bounded parallelism */
export async function probeHosts(remotes: RemoteDoc[], concurrency = 12): Promise<HostHealth[]> {
  const out: HostHealth[] = new Array(remotes.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, remotes.length) }, async () => {
      while (i < remotes.length) {
        const n = i++;
        out[n] = await probeHost(remotes[n]);
      }
    }),
  );
  return out;
}
