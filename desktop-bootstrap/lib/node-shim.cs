using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

static class NodeShim
{
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    static void TieChildrenToThisProcess()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (job == IntPtr.Zero
            || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, Marshal.SizeOf(info))
            || !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
        {
            throw new InvalidOperationException("node: job object unavailable (" + Marshal.GetLastWin32Error() + ")");
        }
    }

    static string ArgumentsAfterProgram(string commandLine)
    {
        int index = 0;
        if (commandLine.StartsWith("\""))
        {
            index = commandLine.IndexOf('"', 1);
            index = index < 0 ? commandLine.Length : index + 1;
        }
        else
        {
            while (index < commandLine.Length && commandLine[index] != ' ' && commandLine[index] != '\t') index++;
        }
        return commandLine.Substring(index).TrimStart(' ', '\t');
    }

    static int Main()
    {
        TieChildrenToThisProcess();
        string executableName = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "application.txt")).Trim();
        string application = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", executableName));
        ProcessStartInfo start = new ProcessStartInfo(application, ArgumentsAfterProgram(Environment.CommandLine));
        start.UseShellExecute = false;
        start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
        using (Process child = Process.Start(start))
        {
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
