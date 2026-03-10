/**
 * Embedded seccomp BPF profile for Docker agent containers.
 *
 * Based on Docker's default profile, with additional blocks for dangerous
 * syscalls that agents should never need:
 *   - ptrace: process debugging/injection
 *   - mount/umount2: filesystem mount manipulation
 *   - reboot/kexec_load: system reboot
 *   - init_module/finit_module: kernel module loading
 *   - pivot_root: root filesystem swapping
 *   - sethostname/setdomainname: hostname manipulation
 *
 * Written to disk at runtime and passed to `docker create --security-opt seccomp=<path>`.
 */
export const SECCOMP_PROFILE = {
  defaultAction: 'SCMP_ACT_ERRNO',
  defaultErrnoRet: 1,
  archMap: [
    {
      architecture: 'SCMP_ARCH_X86_64',
      subArchitectures: ['SCMP_ARCH_X86', 'SCMP_ARCH_X32'],
    },
    {
      architecture: 'SCMP_ARCH_AARCH64',
      subArchitectures: ['SCMP_ARCH_ARM'],
    },
  ],
  syscalls: [
    {
      names: [
        // Process management
        'accept', 'accept4', 'access', 'alarm', 'arch_prctl', 'bind',
        'brk', 'capget', 'capset', 'chdir', 'chmod', 'chown', 'chown32',
        'clock_getres', 'clock_gettime', 'clock_nanosleep', 'clone', 'clone3',
        'close', 'connect', 'copy_file_range', 'creat',
        'dup', 'dup2', 'dup3',
        'epoll_create', 'epoll_create1', 'epoll_ctl', 'epoll_pwait', 'epoll_pwait2', 'epoll_wait',
        'eventfd', 'eventfd2', 'execve', 'execveat', 'exit', 'exit_group',
        'faccessat', 'faccessat2', 'fadvise64', 'fallocate', 'fanotify_mark',
        'fchdir', 'fchmod', 'fchmodat', 'fchown', 'fchown32', 'fchownat',
        'fcntl', 'fcntl64', 'fdatasync',
        'fgetxattr', 'flistxattr', 'flock',
        'fork', 'fremovexattr', 'fsetxattr', 'fstat', 'fstat64',
        'fstatat64', 'fstatfs', 'fstatfs64', 'fsync', 'ftruncate', 'ftruncate64',
        'futex', 'futex_waitv', 'futimesat',
        'getcpu', 'getcwd', 'getdents', 'getdents64', 'getegid', 'getegid32',
        'geteuid', 'geteuid32', 'getgid', 'getgid32', 'getgroups', 'getgroups32',
        'getitimer', 'getpeername', 'getpgid', 'getpgrp', 'getpid', 'getppid',
        'getpriority', 'getrandom', 'getresgid', 'getresgid32', 'getresuid', 'getresuid32',
        'getrlimit', 'getrusage', 'getsid', 'getsockname', 'getsockopt',
        'gettid', 'gettimeofday', 'getuid', 'getuid32', 'getxattr',
        'inotify_add_watch', 'inotify_init', 'inotify_init1', 'inotify_rm_watch',
        'io_cancel', 'io_destroy', 'io_getevents', 'io_setup', 'io_submit',
        'io_uring_enter', 'io_uring_register', 'io_uring_setup',
        'ioctl', 'ioprio_get', 'ioprio_set',
        'kill',
        'lchown', 'lchown32', 'lgetxattr', 'link', 'linkat', 'listen',
        'listxattr', 'llistxattr', 'lremovexattr', 'lseek', 'lsetxattr', 'lstat', 'lstat64',
        'madvise', 'membarrier', 'memfd_create', 'mincore', 'mkdir', 'mkdirat',
        'mknod', 'mknodat', 'mlock', 'mlock2', 'mlockall',
        'mmap', 'mmap2', 'mprotect', 'mq_getsetattr', 'mq_notify', 'mq_open',
        'mq_timedreceive', 'mq_timedsend', 'mq_unlink', 'mremap',
        'msgctl', 'msgget', 'msgrcv', 'msgsnd', 'msync', 'munlock', 'munlockall', 'munmap',
        'name_to_handle_at', 'nanosleep', 'newfstatat',
        'open', 'openat', 'openat2',
        'pause', 'pidfd_open', 'pidfd_send_signal', 'pipe', 'pipe2',
        'poll', 'ppoll', 'prctl', 'pread64', 'preadv', 'preadv2',
        'prlimit64', 'process_vm_readv',
        'pselect6', 'pwrite64', 'pwritev', 'pwritev2',
        'read', 'readahead', 'readlink', 'readlinkat', 'readv',
        'recv', 'recvfrom', 'recvmmsg', 'recvmsg',
        'remap_file_pages', 'removexattr', 'rename', 'renameat', 'renameat2',
        'restart_syscall', 'rmdir',
        'rseq',
        'rt_sigaction', 'rt_sigpending', 'rt_sigprocmask', 'rt_sigqueueinfo',
        'rt_sigreturn', 'rt_sigsuspend', 'rt_sigtimedwait', 'rt_tgsigqueueinfo',
        'sched_get_priority_max', 'sched_get_priority_min', 'sched_getaffinity',
        'sched_getattr', 'sched_getparam', 'sched_getscheduler', 'sched_setaffinity',
        'sched_setattr', 'sched_setparam', 'sched_setscheduler', 'sched_yield',
        'seccomp', 'select', 'semctl', 'semget', 'semop', 'semtimedop',
        'send', 'sendfile', 'sendfile64', 'sendmmsg', 'sendmsg', 'sendto',
        'set_robust_list', 'set_tid_address', 'setfsgid', 'setfsgid32',
        'setfsuid', 'setfsuid32', 'setgid', 'setgid32', 'setgroups', 'setgroups32',
        'setitimer', 'setpgid', 'setpriority', 'setregid', 'setregid32',
        'setresgid', 'setresgid32', 'setresuid', 'setresuid32', 'setreuid', 'setreuid32',
        'setrlimit', 'setsid', 'setsockopt', 'setuid', 'setuid32', 'setxattr',
        'shmat', 'shmctl', 'shmdt', 'shmget', 'shutdown',
        'sigaltstack', 'signalfd', 'signalfd4',
        'socket', 'socketcall', 'socketpair', 'splice',
        'stat', 'stat64', 'statfs', 'statfs64', 'statx',
        'symlink', 'symlinkat', 'sync', 'sync_file_range', 'syncfs',
        'sysinfo', 'syslog',
        'tee', 'tgkill', 'time', 'timer_create', 'timer_delete',
        'timer_getoverrun', 'timer_gettime', 'timer_settime',
        'timerfd_create', 'timerfd_gettime', 'timerfd_settime',
        'times', 'tkill', 'truncate', 'truncate64',
        'ugetrlimit', 'umask', 'uname', 'unlink', 'unlinkat', 'unshare',
        'utime', 'utimensat', 'utimes',
        'vfork', 'vmsplice',
        'wait4', 'waitid', 'waitpid',
        'write', 'writev',
      ],
      action: 'SCMP_ACT_ALLOW',
    },
    {
      // Explicitly blocked dangerous syscalls
      names: [
        'ptrace',
        'mount',
        'umount2',
        'reboot',
        'kexec_load',
        'kexec_file_load',
        'init_module',
        'finit_module',
        'delete_module',
        'pivot_root',
        'sethostname',
        'setdomainname',
        'keyctl',
        'add_key',
        'request_key',
        'bpf',
        'userfaultfd',
        'perf_event_open',
        'lookup_dcookie',
      ],
      action: 'SCMP_ACT_ERRNO',
      errnoRet: 1,
    },
  ],
} as const;

/** Serialize the seccomp profile to a JSON string for writing to disk */
export function serializeSeccompProfile(): string {
  return JSON.stringify(SECCOMP_PROFILE, null, 2);
}
