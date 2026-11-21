import type { ScriptParam, ScriptStep } from "./template";

/** built-in starter scripts for self-hosted server maintenance (copied into the library on use) */
export interface Snippet {
  key: string;
  name: string;
  category: "System" | "Services" | "Docker" | "Storage" | "Network" | "Security" | "Updates";
  description: string;
  params?: ScriptParam[];
  steps: Omit<ScriptStep, "id">[];
}

export const SNIPPETS: Snippet[] = [
  {
    key: "overview",
    name: "System overview",
    category: "System",
    description: "Uptime, load, memory and disk usage",
    steps: [
      {
        command:
          "echo \"== $(hostname) — $(. /etc/os-release 2>/dev/null; echo $PRETTY_NAME)\"\nuptime\necho\nfree -h\necho\ndf -hT -x tmpfs -x devtmpfs -x squashfs -x overlay",
      },
    ],
  },
  {
    key: "top-procs",
    name: "Top processes → kill",
    category: "System",
    description: "Processes by CPU; select PIDs in the output and kill them in step 2",
    params: [
      { name: "count", type: "number", default: "15", label: "Rows" },
      { name: "signal", type: "select", default: "TERM", options: ["TERM", "HUP", "INT", "KILL"] },
    ],
    steps: [
      {
        title: "List processes",
        command: "ps -eo pid,user,%cpu,%mem,etime,comm --sort=-%cpu | head -n $(( {{count}} + 1 ))",
      },
      { title: "Kill selected PIDs", command: "kill -{{signal}} {{sel}} && echo killed {{sel}}", sudo: true },
    ],
  },
  {
    key: "failed-units",
    name: "Failed services → restart",
    category: "Services",
    description: "Lists failed systemd units and restarts them one by one",
    steps: [
      {
        title: "Failed units",
        command: "systemctl --failed --no-legend --plain",
        pick: { mode: "column", column: 1, delimiter: "whitespace" },
      },
      {
        title: "Restart each",
        command: "systemctl restart {{item|q}} && systemctl is-active {{item|q}}",
        foreach: true,
        sudo: true,
        continueOnError: true,
      },
    ],
  },
  {
    key: "service",
    name: "Service status / restart",
    category: "Services",
    description: "Status and recent logs of a systemd service, then restart it",
    params: [{ name: "service", type: "text", required: true, label: "Service", default: "ssh" }],
    steps: [
      { title: "Status", command: "systemctl status {{service|q}} --no-pager -n 30" },
      { title: "Restart", command: "systemctl restart {{service|q}} && systemctl is-active {{service|q}}", sudo: true },
    ],
  },
  {
    key: "journal-errors",
    name: "Journal errors since boot",
    category: "Services",
    description: "Priority err and worse from the systemd journal",
    params: [{ name: "lines", type: "number", default: "100" }],
    steps: [{ command: "journalctl -p err -b --no-pager -n {{lines}}", sudo: true }],
  },
  {
    key: "docker-ps",
    name: "Docker containers → restart",
    category: "Docker",
    description: "Pick containers from `docker ps` and restart them",
    steps: [
      {
        title: "Containers",
        command: "docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}'",
      },
      { title: "Restart selected", command: "docker restart {{sel}}" },
    ],
  },
  {
    key: "docker-logs",
    name: "Docker logs",
    category: "Docker",
    description: "Tail the logs of every container you select",
    params: [{ name: "lines", type: "number", default: "50" }],
    steps: [
      { title: "Running containers", command: "docker ps --format '{{.Names}}'" },
      { title: "Logs", command: "docker logs --tail {{lines}} --timestamps {{item}} 2>&1", foreach: true },
    ],
  },
  {
    key: "compose-update",
    name: "Compose pull & up",
    category: "Docker",
    description: "Pull new images and recreate a docker compose stack",
    params: [{ name: "dir", type: "text", required: true, label: "Compose folder", default: "/opt/stack" }],
    steps: [
      {
        command:
          "cd {{dir|q}} || exit 1\ndocker compose pull\ndocker compose up -d --remove-orphans\ndocker compose ps",
        timeoutSec: 1800,
      },
    ],
  },
  {
    key: "docker-df",
    name: "Docker disk usage & prune",
    category: "Docker",
    description: "Space used by images / volumes, then prune dangling images",
    steps: [
      { title: "Usage", command: "docker system df" },
      { title: "Prune dangling", command: "docker image prune -f && docker system df" },
    ],
  },
  {
    key: "du",
    name: "Biggest folders",
    category: "Storage",
    description: "Drill down: select a folder in the output to look inside it",
    params: [{ name: "path", type: "text", default: "/", label: "Start path" }],
    steps: [
      {
        title: "Sizes",
        command: "du -xh --max-depth=1 {{path|q}} 2>/dev/null | sort -rh | head -n 25",
        sudo: true,
      },
      {
        title: "Inside selection",
        command: "du -xh --max-depth=1 {{item|q}} 2>/dev/null | sort -rh | head -n 25",
        foreach: true,
        sudo: true,
      },
    ],
  },
  {
    key: "big-files",
    name: "Largest files",
    category: "Storage",
    description: "Files above a size on one filesystem",
    params: [
      { name: "path", type: "text", default: "/" },
      { name: "minSize", type: "text", default: "500M", label: "Min size" },
    ],
    steps: [
      {
        command:
          "find {{path|q}} -xdev -type f -size +{{minSize}} -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -50 | numfmt --to=iec --field=1",
        sudo: true,
        timeoutSec: 900,
      },
    ],
  },
  {
    key: "smart",
    name: "Disk SMART health",
    category: "Storage",
    description: "SMART overall health of every physical disk (needs smartmontools)",
    steps: [
      {
        title: "Disks",
        command: "lsblk -dno NAME,TYPE,SIZE,MODEL | awk '$2==\"disk\"'",
        pick: { mode: "column", column: 1 },
      },
      { title: "SMART", command: "smartctl -H /dev/{{item}} | tail -n +4", foreach: true, sudo: true },
    ],
  },
  {
    key: "ports",
    name: "Listening ports",
    category: "Network",
    description: "TCP/UDP sockets and the processes that own them",
    steps: [{ command: "ss -tulpn", sudo: true }],
  },
  {
    key: "http-check",
    name: "HTTP check from host",
    category: "Network",
    description: "Status code and timing of a URL as seen from each target",
    params: [{ name: "url", type: "text", default: "http://localhost", required: true }],
    steps: [
      {
        command:
          "curl -ksS -o /dev/null -w 'code=%{http_code} dns=%{time_namelookup}s connect=%{time_connect}s total=%{time_total}s\\n' {{url|q}}",
      },
    ],
  },
  {
    key: "cert-expiry",
    name: "TLS certificate expiry",
    category: "Security",
    description: "Subject, issuer and validity dates of a TLS endpoint",
    params: [
      { name: "domain", type: "text", required: true, default: "localhost" },
      { name: "port", type: "number", default: "443" },
    ],
    steps: [
      {
        command:
          "echo | openssl s_client -servername {{domain}} -connect {{domain}}:{{port}} 2>/dev/null | openssl x509 -noout -subject -issuer -dates",
      },
    ],
  },
  {
    key: "ssh-auth",
    name: "Logins & failed SSH attempts",
    category: "Security",
    description: "Last logins and failed SSH authentications in the last 24h",
    steps: [
      {
        command:
          "last -n 15 2>/dev/null\necho '--- failed (24h) ---'\njournalctl -u ssh -u sshd --since '24 hours ago' --no-pager 2>/dev/null | grep -Ei 'failed|invalid' | tail -n 40",
        sudo: true,
      },
    ],
  },
  {
    key: "apt-upgrade",
    name: "APT updates",
    category: "Updates",
    description: "Refresh package lists, show upgradable packages, then upgrade",
    steps: [
      {
        title: "Check",
        command: "apt-get update -qq && apt list --upgradable 2>/dev/null | tail -n +2",
        sudo: true,
        timeoutSec: 600,
      },
      {
        title: "Upgrade",
        command: "DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confold upgrade",
        sudo: true,
        timeoutSec: 3600,
      },
    ],
  },
  {
    key: "reboot-required",
    name: "Reboot if required",
    category: "Updates",
    description: "Shows which packages need a reboot; step 2 reboots",
    steps: [
      {
        title: "Check",
        command:
          "if [ -f /var/run/reboot-required ]; then echo 'Reboot required by:'; cat /var/run/reboot-required.pkgs 2>/dev/null; else echo 'No reboot required'; fi",
      },
      { title: "Reboot", command: "systemctl reboot", sudo: true },
    ],
  },
];
