using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace ControlPanelHelper
{
    // ------------------------------------------------------------------ Core Audio COM interfaces
    // Method order must match the Windows SDK headers exactly.

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey
    {
        public Guid fmtid;
        public int pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant
    {
        public ushort vt;
        public ushort r1, r2, r3;
        public IntPtr p;
        public IntPtr p2;
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int streamFlags, out IntPtr sessionControl);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int streamFlags, out IntPtr audioVolume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid group);
        [PreserveSig] int SetGroupingParam(ref Guid group, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr notifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notifications);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid context);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // Used by Windows' own sound settings to change the default device (not in the public SDK,
    // but stable since Windows 7 and used by many audio switcher tools).
    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    class PolicyConfigClient { }

    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int def, IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int def, IntPtr defaultPeriod, IntPtr minPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
    }

    // ------------------------------------------------------------------ public helpers

    public class EndpointState
    {
        public string Id;      // Windows device id
        public string Name;    // e.g. "Headphones (Arctis Nova)"
        public bool IsDefault;
        public bool Available;
        public int Volume;     // 0..100
        public bool Muted;
    }

    public class AppVolume
    {
        public string Key;     // stable id for the app (exe path or "system")
        public string Name;
        public int Volume;
        public bool Muted;
        public string Icon;    // icon id for /api/icon
    }

    static class Audio
    {
        const int eRender = 0, eCapture = 1, eConsole = 0, eMultimedia = 1, CLSCTX_ALL = 23;
        static readonly Guid IID_IAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;
        static readonly Guid IID_IAudioSessionManager2 = typeof(IAudioSessionManager2).GUID;
        static readonly object Gate = new object();
        static Guid ctx = Guid.Empty;

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant pv);

        static PropertyKey FriendlyNameKey = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        const int DEVICE_STATE_ACTIVE = 1;

        static IMMDevice DefaultDevice(int flow)
        {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice dev;
            int hr = enumerator.GetDefaultAudioEndpoint(flow, eMultimedia, out dev);
            Marshal.ReleaseComObject(enumerator);
            return hr == 0 ? dev : null;
        }

        /// <summary>A specific device by id, or the Windows default when id is empty or gone.</summary>
        static IMMDevice Device(int flow, string id)
        {
            if (!string.IsNullOrEmpty(id))
            {
                var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                IMMDevice dev;
                int hr = enumerator.GetDevice(id, out dev);
                Marshal.ReleaseComObject(enumerator);
                if (hr == 0 && dev != null)
                {
                    int state;
                    if (dev.GetState(out state) == 0 && state == DEVICE_STATE_ACTIVE) return dev;
                    Marshal.ReleaseComObject(dev);
                }
            }
            return DefaultDevice(flow);
        }

        static IAudioEndpointVolume Activate(IMMDevice dev)
        {
            if (dev == null) return null;
            object o;
            Guid iid = IID_IAudioEndpointVolume;
            int hr = dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o);
            return hr == 0 ? (IAudioEndpointVolume)o : null;
        }

        static string FriendlyName(IMMDevice dev)
        {
            IPropertyStore store = null;
            try
            {
                if (dev.OpenPropertyStore(0 /* STGM_READ */, out store) != 0 || store == null) return null;
                PropVariant pv;
                if (store.GetValue(ref FriendlyNameKey, out pv) != 0) return null;
                string name = pv.vt == 31 /* VT_LPWSTR */ ? Marshal.PtrToStringUni(pv.p) : null;
                PropVariantClear(ref pv);
                return name;
            }
            catch { return null; }
            finally { if (store != null) Marshal.ReleaseComObject(store); }
        }

        static string IdOf(IMMDevice dev)
        {
            string id;
            return dev != null && dev.GetId(out id) == 0 ? id : null;
        }

        static void Fill(EndpointState s, IMMDevice dev)
        {
            IAudioEndpointVolume ep = Activate(dev);
            if (ep == null) return;
            try
            {
                float v; bool m;
                if (ep.GetMasterVolumeLevelScalar(out v) == 0 && ep.GetMute(out m) == 0)
                {
                    s.Available = true;
                    s.Volume = (int)Math.Round(v * 100);
                    s.Muted = m;
                }
            }
            finally { Marshal.ReleaseComObject(ep); }
        }

        /// <summary>All active output (mic=false) or input (mic=true) devices with their volume.</summary>
        public static List<EndpointState> List(bool mic)
        {
            lock (Gate)
            {
                var list = new List<EndpointState>();
                int flow = mic ? eCapture : eRender;
                IMMDeviceEnumerator enumerator = null;
                IMMDeviceCollection col = null;
                try
                {
                    var def = DefaultDevice(flow);
                    string defId = IdOf(def);
                    if (def != null) Marshal.ReleaseComObject(def);
                    enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                    if (enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, out col) != 0 || col == null) return list;
                    int count;
                    col.GetCount(out count);
                    for (int i = 0; i < count; i++)
                    {
                        IMMDevice dev;
                        if (col.Item(i, out dev) != 0 || dev == null) continue;
                        try
                        {
                            var s = new EndpointState { Id = IdOf(dev), Name = FriendlyName(dev) ?? "Audio device" };
                            s.IsDefault = s.Id != null && s.Id == defId;
                            Fill(s, dev);
                            list.Add(s);
                        }
                        finally { Marshal.ReleaseComObject(dev); }
                    }
                }
                catch (Exception ex) { Log.Write("Audio list: " + ex.Message); }
                finally
                {
                    if (col != null) Marshal.ReleaseComObject(col);
                    if (enumerator != null) Marshal.ReleaseComObject(enumerator);
                }
                // Windows default first, then by name.
                list.Sort(delegate (EndpointState x, EndpointState y)
                {
                    if (x.IsDefault != y.IsDefault) return x.IsDefault ? -1 : 1;
                    return string.Compare(x.Name, y.Name, StringComparison.CurrentCultureIgnoreCase);
                });
                return list;
            }
        }

        public static EndpointState Get(bool mic)
        {
            lock (Gate)
            {
                var s = new EndpointState();
                IMMDevice dev = null;
                try
                {
                    dev = DefaultDevice(mic ? eCapture : eRender);
                    if (dev == null) return s;
                    s.Id = IdOf(dev);
                    s.Name = FriendlyName(dev);
                    s.IsDefault = true;
                    Fill(s, dev);
                }
                catch (Exception ex) { Log.Write("Audio get: " + ex.Message); }
                finally { if (dev != null) Marshal.ReleaseComObject(dev); }
                return s;
            }
        }

        public static void SetVolume(bool mic, string deviceId, int volume)
        {
            lock (Gate)
            {
                IMMDevice dev = null;
                IAudioEndpointVolume ep = null;
                try
                {
                    dev = Device(mic ? eCapture : eRender, deviceId);
                    ep = Activate(dev);
                    if (ep == null) return;
                    ep.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, volume)) / 100f, ref ctx);
                    if (volume > 0) ep.SetMute(false, ref ctx);
                }
                catch (Exception ex) { Log.Write("Audio set: " + ex.Message); }
                finally
                {
                    if (ep != null) Marshal.ReleaseComObject(ep);
                    if (dev != null) Marshal.ReleaseComObject(dev);
                }
            }
        }

        public static void SetMute(bool mic, string deviceId, bool mute)
        {
            lock (Gate)
            {
                IMMDevice dev = null;
                IAudioEndpointVolume ep = null;
                try
                {
                    dev = Device(mic ? eCapture : eRender, deviceId);
                    ep = Activate(dev);
                    if (ep != null) ep.SetMute(mute, ref ctx);
                }
                catch (Exception ex) { Log.Write("Audio mute: " + ex.Message); }
                finally
                {
                    if (ep != null) Marshal.ReleaseComObject(ep);
                    if (dev != null) Marshal.ReleaseComObject(dev);
                }
            }
        }

        /// <summary>Makes a device the Windows default (for all apps, games and calls).</summary>
        public static bool SetDefault(bool mic, string deviceId)
        {
            if (string.IsNullOrEmpty(deviceId)) return false;
            lock (Gate)
            {
                // Only accept ids of devices that really exist and are active.
                bool known = false;
                foreach (var e in List(mic)) if (e.Id == deviceId) known = true;
                if (!known) return false;
                IPolicyConfig pc = null;
                try
                {
                    pc = (IPolicyConfig)(new PolicyConfigClient());
                    int hr = 0;
                    for (int role = 0; role < 3; role++) hr |= pc.SetDefaultEndpoint(deviceId, role);
                    if (hr != 0) Log.Write("Set default device: 0x" + hr.ToString("X8"));
                    return hr == 0;
                }
                catch (Exception ex) { Log.Write("Set default device: " + ex.Message); return false; }
                finally { if (pc != null) Marshal.ReleaseComObject(pc); }
            }
        }

        // ------------------------------------------------------------------ app mixer

        delegate void SessionVisitor(string key, string name, ISimpleAudioVolume vol, string exePath);

        static void VisitSessions(SessionVisitor visit)
        {
            IMMDevice dev = null;
            IAudioSessionManager2 mgr = null;
            IAudioSessionEnumerator en = null;
            try
            {
                dev = DefaultDevice(eRender);
                if (dev == null) return;
                object o;
                Guid iid = IID_IAudioSessionManager2;
                if (dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o) != 0) return;
                mgr = (IAudioSessionManager2)o;
                if (mgr.GetSessionEnumerator(out en) != 0 || en == null) return;
                int count;
                en.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    object so;
                    if (en.GetSession(i, out so) != 0 || so == null) continue;
                    try
                    {
                        var ctl = so as IAudioSessionControl2;
                        var vol = so as ISimpleAudioVolume;
                        if (ctl == null || vol == null) continue;
                        int state;
                        ctl.GetState(out state);
                        if (state == 2) continue; // expired
                        if (ctl.IsSystemSoundsSession() == 0)
                        {
                            visit("system", "System sounds", vol, null);
                            continue;
                        }
                        uint pid;
                        ctl.GetProcessId(out pid);
                        string path = ProcessInfo.ExePath((int)pid);
                        string name = ProcessInfo.FriendlyName((int)pid, path);
                        if (string.IsNullOrEmpty(name))
                        {
                            string dn;
                            ctl.GetDisplayName(out dn);
                            name = string.IsNullOrEmpty(dn) || dn.StartsWith("@") ? "App " + pid : dn;
                        }
                        string key = string.IsNullOrEmpty(path) ? "pid:" + pid : path.ToLowerInvariant();
                        visit(key, name, vol, path);
                    }
                    finally { Marshal.ReleaseComObject(so); }
                }
            }
            catch (Exception ex) { Log.Write("Sessions: " + ex.Message); }
            finally
            {
                if (en != null) Marshal.ReleaseComObject(en);
                if (mgr != null) Marshal.ReleaseComObject(mgr);
                if (dev != null) Marshal.ReleaseComObject(dev);
            }
        }

        /// <summary>One entry per app (apps like Chrome have several sessions).</summary>
        public static List<AppVolume> GetApps()
        {
            lock (Gate)
            {
                var byKey = new Dictionary<string, AppVolume>();
                var order = new List<AppVolume>();
                VisitSessions(delegate (string key, string name, ISimpleAudioVolume vol, string exe)
                {
                    if (byKey.ContainsKey(key)) return;
                    float v; bool m;
                    vol.GetMasterVolume(out v);
                    vol.GetMute(out m);
                    var a = new AppVolume
                    {
                        Key = key,
                        Name = name,
                        Volume = (int)Math.Round(v * 100),
                        Muted = m,
                        Icon = exe != null ? Icons.Register(exe) : null
                    };
                    byKey[key] = a;
                    order.Add(a);
                });
                // System sounds last, everything else by name.
                order.Sort(delegate (AppVolume x, AppVolume y)
                {
                    if (x.Key == "system") return 1;
                    if (y.Key == "system") return -1;
                    return string.Compare(x.Name, y.Name, StringComparison.CurrentCultureIgnoreCase);
                });
                return order;
            }
        }

        public static void SetApp(string key, int? volume, bool? mute)
        {
            lock (Gate)
            {
                VisitSessions(delegate (string k, string name, ISimpleAudioVolume vol, string exe)
                {
                    if (k != key) return;
                    if (volume.HasValue) vol.SetMasterVolume(Math.Max(0, Math.Min(100, volume.Value)) / 100f, ref ctx);
                    if (mute.HasValue) vol.SetMute(mute.Value, ref ctx);
                });
            }
        }
    }

    /// <summary>Process path and friendly name, also for programs running as administrator.</summary>
    static class ProcessInfo
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(int access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool QueryFullProcessImageName(IntPtr hProcess, int flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr h);

        static readonly Dictionary<string, string> NameCache = new Dictionary<string, string>();

        public static string ExePath(int pid)
        {
            if (pid <= 4) return null;
            IntPtr h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                int size = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : null;
            }
            finally { CloseHandle(h); }
        }

        public static string FriendlyName(int pid, string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            lock (NameCache)
            {
                string name;
                if (NameCache.TryGetValue(path, out name)) return name;
                try
                {
                    var info = FileVersionInfo.GetVersionInfo(path);
                    name = !string.IsNullOrWhiteSpace(info.FileDescription) ? info.FileDescription.Trim()
                         : !string.IsNullOrWhiteSpace(info.ProductName) ? info.ProductName.Trim()
                         : Path.GetFileNameWithoutExtension(path);
                }
                catch { name = Path.GetFileNameWithoutExtension(path); }
                NameCache[path] = name;
                return name;
            }
        }
    }
}
