param([string]$WindowHandle = '0', [switch]$Check)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class PieceMakerVerification {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CredUI {
        public int size;
        public IntPtr parent;
        public string message;
        public string caption;
        public IntPtr banner;
    }
    [DllImport("credui.dll", CharSet = CharSet.Unicode)]
    static extern uint CredUIPromptForWindowsCredentialsW(ref CredUI info, uint error, ref uint package, IntPtr input, uint inputSize, out IntPtr output, out uint outputSize, IntPtr save, uint flags);
    [DllImport("credui.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredUnPackAuthenticationBufferW(uint flags, IntPtr input, uint size, IntPtr username, ref uint usernameSize, IntPtr domain, ref uint domainSize, IntPtr password, ref uint passwordSize);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool LogonUserW(IntPtr username, string domain, IntPtr password, int type, int provider, out IntPtr token);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
    static void Clear(IntPtr pointer, uint bytes) {
        if (pointer == IntPtr.Zero) return;
        for (uint index = 0; index < bytes; index++) Marshal.WriteByte(pointer, (int)index, 0);
    }
    public static bool Verify(long window) {
        var info = new CredUI { parent = new IntPtr(window), message = "Saisissez le mot de passe de votre compte Windows pour reinitialiser PieceMaker.", caption = "PieceMaker" };
        info.size = Marshal.SizeOf(info);
        uint package = 0, size = 0;
        IntPtr blob = IntPtr.Zero, username = IntPtr.Zero, domain = IntPtr.Zero, password = IntPtr.Zero, token = IntPtr.Zero;
        uint userSize = 0, domainSize = 0, passwordSize = 0;
        uint allocatedUser = 0, allocatedDomain = 0, allocatedPassword = 0;
        try {
            if (CredUIPromptForWindowsCredentialsW(ref info, 0, ref package, IntPtr.Zero, 0, out blob, out size, IntPtr.Zero, 0x200) != 0) return false;
            CredUnPackAuthenticationBufferW(1, blob, size, IntPtr.Zero, ref userSize, IntPtr.Zero, ref domainSize, IntPtr.Zero, ref passwordSize);
            if (Marshal.GetLastWin32Error() != 122 || userSize == 0 || passwordSize == 0 || userSize > 65536 || domainSize > 65536 || passwordSize > 65536) return false;
            allocatedUser = userSize * 2;
            allocatedDomain = Math.Max(domainSize, 1u) * 2;
            allocatedPassword = passwordSize * 2;
            username = Marshal.AllocHGlobal((int)allocatedUser);
            domain = Marshal.AllocHGlobal((int)allocatedDomain);
            password = Marshal.AllocHGlobal((int)allocatedPassword);
            if (!CredUnPackAuthenticationBufferW(1, blob, size, username, ref userSize, domain, ref domainSize, password, ref passwordSize)) return false;
            var account = Marshal.PtrToStringUni(username);
            var domainName = domainSize > 0 ? Marshal.PtrToStringUni(domain) : null;
            if (account.Contains("@") && domainName != "MicrosoftAccount") domainName = null;
            if (account.Contains("\\")) {
                var parts = account.Split(new char[] { '\\' }, 2);
                domainName = parts[0];
                Marshal.Copy((parts[1] + "\0").ToCharArray(), 0, username, parts[1].Length + 1);
            }
            if (!LogonUserW(username, String.IsNullOrEmpty(domainName) ? null : domainName, password, 2, 0, out token)) return false;
            using (var authenticated = new WindowsIdentity(token))
            using (var current = WindowsIdentity.GetCurrent()) return authenticated.User.Equals(current.User);
        } finally {
            Clear(blob, size);
            Clear(username, allocatedUser);
            Clear(domain, allocatedDomain);
            Clear(password, allocatedPassword);
            if (blob != IntPtr.Zero) Marshal.FreeCoTaskMem(blob);
            if (username != IntPtr.Zero) Marshal.FreeHGlobal(username);
            if (domain != IntPtr.Zero) Marshal.FreeHGlobal(domain);
            if (password != IntPtr.Zero) Marshal.FreeHGlobal(password);
            if (token != IntPtr.Zero) CloseHandle(token);
        }
    }
}
'@
if ($Check) { 'available'; exit 0 }
if ([PieceMakerVerification]::Verify([long]::Parse($WindowHandle))) { 'verified'; exit 0 }
exit 1
