import os
import pwd

pw = pwd.getpwnam("postgres")
os.setgid(pw.pw_gid)
os.setuid(pw.pw_uid)
os.environ["HOME"] = pw.pw_dir
os.execv(
    "/usr/lib/postgresql/16/bin/pg_ctl",
    ["/usr/lib/postgresql/16/bin/pg_ctl", "-D", "/var/tmp/th-pg/data", "-l", "/var/tmp/th-pg/log", "-o", "-p 54331 -k /var/tmp/th-pg", "start"],
)
