param(
    [int]$X = 0,
    [int]$Y = 0,
    [string]$TargetsJson = "",
    [int]$IntervalMs = 500,
    [int]$MaxClicks = 0,
    [long]$TargetHandle = 0
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class MouseOps {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr hdc, int nXPos, int nYPos);

    public static int ColorDiff(int x, int y, int expR, int expG, int expB) {
        IntPtr hdc = GetDC(IntPtr.Zero);
        uint p = GetPixel(hdc, x, y);
        ReleaseDC(IntPtr.Zero, hdc);
        if (p == 0xFFFFFFFF) return 999;
        int r = (int)(p & 0xFF);
        int g = (int)((p >> 8) & 0xFF);
        int b = (int)((p >> 16) & 0xFF);
        return Math.Abs(r - expR) + Math.Abs(g - expG) + Math.Abs(b - expB);
    }
}
"@

if ($TargetHandle -ne 0) {
    try {
        $hWnd = [IntPtr]::new($TargetHandle)
        [MouseOps]::ShowWindow($hWnd, 9)
        [MouseOps]::SetForegroundWindow($hWnd)
        Start-Sleep -Milliseconds 400
    } catch {}
}

# Parse targets list
$targetsList = @()
if ($TargetsJson -and $TargetsJson.Trim() -ne "") {
    $parsed = $TargetsJson | ConvertFrom-Json
    if ($parsed -is [System.Array]) {
        $targetsList = $parsed
    } else {
        $targetsList = @($parsed)
    }
} elseif ($X -ne 0 -or $Y -ne 0) {
    $targetsList = @([PSCustomObject]@{ x = $X; y = $Y; name = "Target 1" })
}

if ($targetsList.Count -eq 0) {
    Write-Host "No targets specified"
    exit 1
}

$count = 0
$clickDownMs = 45

while ($MaxClicks -eq 0 -or $count -lt $MaxClicks) {
    foreach ($t in $targetsList) {
        if ($MaxClicks -ne 0 -and $count -ge $MaxClicks) { break }

        # Smart detection: check if button color matches on screen
        if ($t.colorDetect -and $t.r -ne $null -and $t.g -ne $null -and $t.b -ne $null) {
            $diff = [MouseOps]::ColorDiff([int]$t.x, [int]$t.y, [int]$t.r, [int]$t.g, [int]$t.b)
            $tol = if ($t.tolerance) { [int]$t.tolerance } else { 95 }
            if ($diff -gt $tol) {
                # Button not currently visible on screen -> skip without clicking!
                continue
            }
        }

        # Button is visible! Click it!
        [MouseOps]::SetCursorPos([int]$t.x, [int]$t.y)
        [MouseOps]::mouse_event(2, 0, 0, 0, 0)      # MOUSEEVENTF_LEFTDOWN
        Start-Sleep -Milliseconds $clickDownMs
        [MouseOps]::mouse_event(4, 0, 0, 0, 0)      # MOUSEEVENTF_LEFTUP
        $count++

        [Console]::Write("click:$count`n")
        [Console]::Out.Flush()

        if ($targetsList.Count -gt 1) {
            Start-Sleep -Milliseconds 120
        }
    }

    Start-Sleep -Milliseconds $IntervalMs
}

[Console]::Write("done:$count`n")
[Console]::Out.Flush()
