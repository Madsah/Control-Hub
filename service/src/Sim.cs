using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    /// <summary>
    /// Live data from Microsoft Flight Simulator 2024 through SimConnect (SimConnect.dll from the free MSFS SDK).
    /// Only connects while MSFS is running. Also works out the flight phase, the landing rate and the flight log.
    /// </summary>
    static class Sim
    {
        // ------------------------------------------------------------------ SimConnect.dll, loaded at runtime
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibrary(string path);
        [DllImport("kernel32.dll", CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr module, string name);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int OpenFn(out IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string name, IntPtr hwnd, uint userEvent, IntPtr hEvent, uint config);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CloseFn(IntPtr h);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int AddDefFn(IntPtr h, uint defId, [MarshalAs(UnmanagedType.LPStr)] string datum, [MarshalAs(UnmanagedType.LPStr)] string units, int type, float epsilon, uint datumId);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RequestFn(IntPtr h, uint reqId, uint defId, uint objectId, int period, uint flags, uint origin, uint interval, uint limit);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int NextFn(IntPtr h, out IntPtr data, out uint size);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int MapEventFn(IntPtr h, uint eventId, [MarshalAs(UnmanagedType.LPStr)] string name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TransmitFn(IntPtr h, uint objectId, uint eventId, uint data, uint group, uint flags);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetDataFn(IntPtr h, uint defId, uint objectId, uint flags, uint count, uint unitSize, IntPtr data);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SubscribeFn(IntPtr h, uint eventId, [MarshalAs(UnmanagedType.LPStr)] string name);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RequestByTypeFn(IntPtr h, uint reqId, uint defId, uint radiusMeters, int type);

        static OpenFn sOpen; static CloseFn sClose; static AddDefFn sAddDef; static RequestFn sRequest; static NextFn sNext;
        static MapEventFn sMapEvent; static TransmitFn sTransmit; static SetDataFn sSetData; static SubscribeFn sSubscribe; static RequestByTypeFn sRequestByType;
        static string dllPath;

        const int FLOAT64 = 4, STRING8 = 5, STRING32 = 6, STRING64 = 7, STRING256 = 9;
        const int PERIOD_VISUAL_FRAME = 2;
        const uint USER = 0, UNUSED = 0xFFFFFFFF;
        const uint DEF_MAIN = 1, DEF_CAMERA = 2, DEF_TRAFFIC = 3, REQ_MAIN = 1, REQ_TRAFFIC = 2;
        const uint EV_PAUSE_TOGGLE = 1, EV_RATE_UP = 2, EV_RATE_DOWN = 3, EV_PAUSE_STATE = 10;
        const int RECV_EXCEPTION = 1, RECV_QUIT = 3, RECV_EVENT = 4, RECV_SIMOBJECT_DATA = 8, RECV_SIMOBJECT_DATA_BYTYPE = 9;
        const int SIMOBJECT_TYPE_AIRCRAFT = 2;

        // The values asked for, in this order (all numbers), then the aircraft title.
        static readonly string[][] Vars =
        {
            new[] { "PLANE LATITUDE", "degrees" }, new[] { "PLANE LONGITUDE", "degrees" },
            new[] { "PLANE ALTITUDE", "feet" }, new[] { "PLANE ALT ABOVE GROUND", "feet" },
            new[] { "AIRSPEED INDICATED", "knots" }, new[] { "GROUND VELOCITY", "knots" },
            new[] { "VERTICAL SPEED", "feet per minute" }, new[] { "PLANE HEADING DEGREES MAGNETIC", "degrees" },
            new[] { "PLANE HEADING DEGREES TRUE", "degrees" }, new[] { "SIM ON GROUND", "bool" },
            new[] { "FUEL TOTAL QUANTITY WEIGHT", "pounds" },
            new[] { "ENG FUEL FLOW PPH:1", "pounds per hour" }, new[] { "ENG FUEL FLOW PPH:2", "pounds per hour" },
            new[] { "ENG FUEL FLOW PPH:3", "pounds per hour" }, new[] { "ENG FUEL FLOW PPH:4", "pounds per hour" },
            new[] { "ENG COMBUSTION:1", "bool" }, new[] { "ENG COMBUSTION:2", "bool" },
            new[] { "BRAKE PARKING POSITION", "bool" },
            new[] { "COM ACTIVE FREQUENCY:1", "MHz" }, new[] { "COM STANDBY FREQUENCY:1", "MHz" },
            new[] { "COM ACTIVE FREQUENCY:2", "MHz" }, new[] { "TRANSPONDER CODE:1", "number" },
            new[] { "ZULU TIME", "seconds" }, new[] { "LOCAL TIME", "seconds" },
            new[] { "SIMULATION RATE", "number" }, new[] { "PLANE TOUCHDOWN NORMAL VELOCITY", "feet per second" },
            new[] { "PLANE TOUCHDOWN BANK DEGREES", "degrees" }, new[] { "PLANE TOUCHDOWN PITCH DEGREES", "degrees" },
            new[] { "G FORCE", "GForce" }, new[] { "CAMERA STATE", "enum" },
            // For FlightLine's black box (FlightRec.cs).
            new[] { "GEAR HANDLE POSITION", "bool" }, new[] { "FLAPS HANDLE INDEX", "number" },
            new[] { "LIGHT LANDING", "bool" }, new[] { "LIGHT BEACON", "bool" }, new[] { "LIGHT STROBE", "bool" },
            new[] { "LIGHT TAXI", "bool" }, new[] { "LIGHT NAV", "bool" }, new[] { "AUTOPILOT MASTER", "bool" },
            new[] { "SPOILERS HANDLE POSITION", "percent" },
        };
        const int V_LAT = 0, V_LON = 1, V_ALT = 2, V_AGL = 3, V_IAS = 4, V_GS = 5, V_VS = 6, V_HDG = 7, V_TRK = 8, V_GROUND = 9,
            V_FUEL = 10, V_FF1 = 11, V_COMB1 = 15, V_COMB2 = 16, V_PARK = 17, V_COM1 = 18, V_COM1S = 19, V_COM2 = 20, V_XPDR = 21,
            V_ZULU = 22, V_LOCAL = 23, V_RATE = 24, V_TD_VEL = 25, V_TD_BANK = 26, V_TD_PITCH = 27, V_G = 28, V_CAM = 29,
            V_GEAR = 30, V_FLAPS = 31, V_L_LAND = 32, V_L_BEACON = 33, V_L_STROBE = 34, V_L_TAXI = 35, V_L_NAV = 36, V_AP = 37, V_SPOIL = 38;

        static readonly object Gate = new object();
        static readonly object Io = new object(); // SimConnect calls, one at a time
        static Thread loop;
        static IntPtr handle = IntPtr.Zero;
        static bool connected, msfsRunning, paused;
        static string title = "", status = "";
        static double[] v = new double[Vars.Length];
        static DateTime lastData = DateTime.MinValue;

        public static bool DllFound { get { return FindDll() != null; } }

        static string FindDll()
        {
            if (dllPath != null && File.Exists(dllPath)) return dllPath;
            // A copy is kept in the helper's settings folder, so it survives replacing the helper folder.
            string kept = KeptDll;
            var tries = new List<string>();
            tries.Add(kept);
            tries.Add(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "SimConnect.dll"));
            foreach (var env in new[] { "MSFS2024_SDK", "MSFS_SDK" })
            {
                string root = Environment.GetEnvironmentVariable(env);
                if (!string.IsNullOrEmpty(root)) tries.Add(Path.Combine(root, "SimConnect SDK", "lib", "SimConnect.dll"));
            }
            foreach (var drive in new[] { "C:", "D:", "E:", "F:" })
                foreach (var name in new[] { "MSFS 2024 SDK", "MSFS SDK" })
                    tries.Add(Path.Combine(drive + "\\", name, "SimConnect SDK", "lib", "SimConnect.dll"));
            foreach (var t in tries)
            {
                try
                {
                    if (!File.Exists(t)) continue;
                    if (t != kept) Keep(t);
                    return dllPath = t;
                }
                catch { }
            }
            return null;
        }

        public static readonly string KeptDll = Path.Combine(Settings.Folder, "SimConnect.dll");

        /// <summary>Copies SimConnect.dll into the settings folder (used by the tray menu, and when it's found somewhere else).</summary>
        public static bool Keep(string from)
        {
            try
            {
                if (!string.Equals(Path.GetFileName(from), "SimConnect.dll", StringComparison.OrdinalIgnoreCase)) return false;
                Directory.CreateDirectory(Settings.Folder);
                if (File.Exists(KeptDll) && new FileInfo(KeptDll).Length == new FileInfo(from).Length) return true;
                File.Copy(from, KeptDll, true);
                Log.Write("Sim: kept a copy of SimConnect.dll in " + Settings.Folder);
                return true;
            }
            catch (Exception ex) { Log.Write("Sim: couldn't keep SimConnect.dll: " + ex.Message); return false; }
        }

        static bool LoadDll()
        {
            if (sOpen != null) return true;
            string path = FindDll();
            if (path == null) return false;
            IntPtr mod = LoadLibrary(path);
            if (mod == IntPtr.Zero) { Log.Write("Sim: couldn't load " + path + " (error " + Marshal.GetLastWin32Error() + ")"); return false; }
            sOpen = Fn<OpenFn>(mod, "SimConnect_Open");
            sClose = Fn<CloseFn>(mod, "SimConnect_Close");
            sAddDef = Fn<AddDefFn>(mod, "SimConnect_AddToDataDefinition");
            sRequest = Fn<RequestFn>(mod, "SimConnect_RequestDataOnSimObject");
            sNext = Fn<NextFn>(mod, "SimConnect_GetNextDispatch");
            sMapEvent = Fn<MapEventFn>(mod, "SimConnect_MapClientEventToSimEvent");
            sTransmit = Fn<TransmitFn>(mod, "SimConnect_TransmitClientEvent");
            sSetData = Fn<SetDataFn>(mod, "SimConnect_SetDataOnSimObject");
            sSubscribe = Fn<SubscribeFn>(mod, "SimConnect_SubscribeToSystemEvent");
            sRequestByType = Fn<RequestByTypeFn>(mod, "SimConnect_RequestDataOnSimObjectType");
            Log.Write("Sim: using " + path);
            return sOpen != null && sNext != null;
        }

        static T Fn<T>(IntPtr mod, string name) where T : class
        {
            IntPtr p = GetProcAddress(mod, name);
            return p == IntPtr.Zero ? null : Marshal.GetDelegateForFunctionPointer(p, typeof(T)) as T;
        }

        // ------------------------------------------------------------------ connection loop

        public static void Start()
        {
            if (loop != null) return;
            loop = new Thread(Loop) { IsBackground = true, Name = "sim" };
            loop.Start();
        }

        static void Loop()
        {
            DateTime nextCheck = DateTime.MinValue;
            while (true)
            {
                try
                {
                    if (!connected)
                    {
                        if (DateTime.UtcNow >= nextCheck)
                        {
                            nextCheck = DateTime.UtcNow.AddSeconds(10);
                            msfsRunning = IsMsfsRunning();
                            if (!msfsRunning) { status = "MSFS isn't running"; SimClosed(); }
                            else if (!LoadDll()) status = "SimConnect.dll not found";
                            else Connect();
                        }
                        Thread.Sleep(1000);
                        continue;
                    }
                    Pump();
                    AskTraffic();
                    Thread.Sleep(100);
                }
                catch (Exception ex)
                {
                    Log.Write("Sim: " + ex.Message);
                    Disconnect();
                    Thread.Sleep(2000);
                }
            }
        }

        static bool IsMsfsRunning()
        {
            foreach (var name in new[] { "FlightSimulator2024", "FlightSimulator" })
            {
                var list = Process.GetProcessesByName(name);
                bool any = list.Length > 0;
                foreach (var p in list) p.Dispose();
                if (any) return true;
            }
            return false;
        }

        static void Connect()
        {
            IntPtr h;
            int hr = sOpen(out h, "Control Panel", IntPtr.Zero, 0, IntPtr.Zero, 0);
            if (hr != 0 || h == IntPtr.Zero) { status = "MSFS is starting…"; return; }
            handle = h;
            for (int i = 0; i < Vars.Length; i++) sAddDef(h, DEF_MAIN, Vars[i][0], Vars[i][1], FLOAT64, 0, UNUSED);
            sAddDef(h, DEF_MAIN, "TITLE", null, STRING256, 0, UNUSED);
            sAddDef(h, DEF_CAMERA, "CAMERA STATE", "enum", FLOAT64, 0, UNUSED);
            // Other aircraft around you (AI and SayIntentions traffic), only asked for while the map shows them.
            foreach (var tv in new[] { new[] { "PLANE LATITUDE", "degrees" }, new[] { "PLANE LONGITUDE", "degrees" }, new[] { "PLANE ALTITUDE", "feet" },
                new[] { "PLANE HEADING DEGREES TRUE", "degrees" }, new[] { "GROUND VELOCITY", "knots" }, new[] { "SIM ON GROUND", "bool" } })
                sAddDef(h, DEF_TRAFFIC, tv[0], tv[1], FLOAT64, 0, UNUSED);
            sAddDef(h, DEF_TRAFFIC, "ATC ID", null, STRING32, 0, UNUSED);
            sAddDef(h, DEF_TRAFFIC, "ATC AIRLINE", null, STRING64, 0, UNUSED);
            sAddDef(h, DEF_TRAFFIC, "ATC FLIGHT NUMBER", null, STRING8, 0, UNUSED);
            // About 3 times a second (every 20th frame).
            sRequest(h, REQ_MAIN, DEF_MAIN, USER, PERIOD_VISUAL_FRAME, 0, 0, 20, 0);
            sMapEvent(h, EV_PAUSE_TOGGLE, "PAUSE_TOGGLE");
            sMapEvent(h, EV_RATE_UP, "SIM_RATE_INCR");
            sMapEvent(h, EV_RATE_DOWN, "SIM_RATE_DECR");
            sSubscribe(h, EV_PAUSE_STATE, "Pause");
            connected = true;
            status = "connected";
            Log.Write("Sim: connected to MSFS");
        }

        static void Disconnect()
        {
            if (handle != IntPtr.Zero) { try { sClose(handle); } catch { } }
            handle = IntPtr.Zero;
            if (connected) Log.Write("Sim: disconnected");
            connected = false;
            status = "MSFS closed";
        }

        static void Pump()
        {
            lock (Io) PumpLocked();
        }

        static void PumpLocked()
        {
            for (int n = 0; n < 50; n++)
            {
                IntPtr data;
                uint size;
                if (sNext(handle, out data, out size) != 0 || data == IntPtr.Zero) break;
                int id = Marshal.ReadInt32(data, 8);
                if (id == RECV_QUIT) { Disconnect(); return; }
                if (id == RECV_EVENT)
                {
                    uint ev = (uint)Marshal.ReadInt32(data, 16);
                    if (ev == EV_PAUSE_STATE) paused = Marshal.ReadInt32(data, 20) != 0;
                }
                else if (id == RECV_SIMOBJECT_DATA && Marshal.ReadInt32(data, 12) == REQ_MAIN)
                {
                    var vals = new double[Vars.Length];
                    var raw = new byte[8 * Vars.Length];
                    Marshal.Copy(new IntPtr(data.ToInt64() + 40), raw, 0, raw.Length);
                    for (int i = 0; i < Vars.Length; i++) vals[i] = BitConverter.ToDouble(raw, 8 * i);
                    var tb = new byte[256];
                    Marshal.Copy(new IntPtr(data.ToInt64() + 40 + raw.Length), tb, 0, 256);
                    int z = Array.IndexOf(tb, (byte)0);
                    string t = Encoding.UTF8.GetString(tb, 0, z < 0 ? 256 : z);
                    lock (Gate)
                    {
                        v = vals;
                        title = t;
                        lastData = DateTime.UtcNow;
                        Track();
                    }
                }
                else if (id == RECV_SIMOBJECT_DATA_BYTYPE && Marshal.ReadInt32(data, 12) == REQ_TRAFFIC)
                {
                    ReadTraffic(data, Marshal.ReadInt32(data, 28), Marshal.ReadInt32(data, 32));
                }
                else if (id == RECV_EXCEPTION)
                {
                    Log.Write("Sim: SimConnect exception " + Marshal.ReadInt32(data, 12) + " (index " + Marshal.ReadInt32(data, 20) + ")");
                }
            }
        }

        // ------------------------------------------------------------------ flight phase, landing rate, flight log

        static string phase = "parked";
        static bool wasOnGround = true, airborneThisFlight;
        static long blockOut, takeoffAt, landingAt, blockIn;
        static double fuelAtBlockOut;
        static Dictionary<string, object> lastLanding;
        static int landingPending; // samples to wait for the touchdown values
        static double peakG, tdLat, tdLon, tdTrk, tdIas;

        public static Dictionary<string, object> Plan = new Dictionary<string, object>(); // from the widget (SimBrief)

        static long Now() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }

        // Called with Gate held, about 3 times a second.
        static void Track()
        {
            // Moved more than 20 nm at once: a new flight was started in the sim (or the plane was moved). The flight so far ends there.
            if (blockOut > 0 && blockIn == 0 && prevLat != 0 && FlightRec.Nm(prevLat, prevLon, v[V_LAT], v[V_LON]) > 20)
            {
                FlightRec.Abort("A new flight was started in the sim");
                ResetFlight();
            }
            prevLat = v[V_LAT]; prevLon = v[V_LON];
            TrackFlight();
            if (blockOut > 0 && blockIn == 0) FlightRec.Tick(Sample(), airborneThisFlight);
        }

        static double prevLat, prevLon;

        static void ResetFlight()
        {
            blockOut = takeoffAt = landingAt = blockIn = 0;
            airborneThisFlight = false;
            wasOnGround = true;
            landingPending = 0;
        }

        /// <summary>MSFS was closed in the middle of a flight: what was recorded is kept, and the next flight starts fresh.</summary>
        static void SimClosed()
        {
            lock (Gate)
            {
                if (blockOut > 0 && blockIn == 0) FlightRec.Abort("MSFS was closed");
                ResetFlight();
                prevLat = prevLon = 0;
            }
        }

        static FlightRec.Sample Sample()
        {
            var s = new FlightRec.Sample();
            s.Lat = v[V_LAT]; s.Lon = v[V_LON]; s.Alt = v[V_ALT]; s.Agl = v[V_AGL]; s.Ias = v[V_IAS]; s.Gs = v[V_GS]; s.Vs = v[V_VS]; s.Hdg = v[V_TRK];
            s.Fuel = v[V_FUEL]; s.Gear = v[V_GEAR]; s.Flaps = v[V_FLAPS]; s.Spoilers = v[V_SPOIL];
            s.Ground = v[V_GROUND] > 0.5; s.Engines = v[V_COMB1] > 0.5 || v[V_COMB2] > 0.5; s.Park = v[V_PARK] > 0.5;
            s.LightLanding = v[V_L_LAND] > 0.5; s.LightBeacon = v[V_L_BEACON] > 0.5; s.LightStrobe = v[V_L_STROBE] > 0.5;
            s.LightTaxi = v[V_L_TAXI] > 0.5; s.LightNav = v[V_L_NAV] > 0.5; s.Autopilot = v[V_AP] > 0.5;
            s.Aircraft = title;
            return s;
        }

        static void TrackFlight()
        {
            bool ground = v[V_GROUND] > 0.5;
            double gs = v[V_GS], vs = v[V_VS], agl = v[V_AGL];
            bool engines = v[V_COMB1] > 0.5 || v[V_COMB2] > 0.5;
            bool park = v[V_PARK] > 0.5;

            if (!ground && agl > 500) peakG = 0;
            if ((!ground && agl < 80) || landingPending > 0) peakG = Math.Max(peakG, v[V_G]);
            if (ground)
            {
                if (!wasOnGround && airborneThisFlight)
                {
                    landingAt = Now();
                    FlightRec.Touchdown(landingAt);
                    landingPending = 3;
                    tdLat = v[V_LAT]; tdLon = v[V_LON]; tdTrk = v[V_TRK]; tdIas = v[V_IAS];
                }
                if (blockOut == 0 && engines && gs > 2 && !park)
                {
                    blockOut = Now();
                    fuelAtBlockOut = v[V_FUEL];
                    FlightRec.Begin(blockOut, Sample(), PlanStr("from"), PlanStr("to"), PlanStr("flight"));
                }
                if (landingAt > 0 && blockIn == 0 && gs < 1 && (!engines || park) && (Now() - landingAt) > 20000)
                {
                    blockIn = Now();
                    WriteLog();
                    FlightRec.End(blockIn, v[V_FUEL]);
                }
                phase = !engines || (park && gs < 1) ? "parked" : gs > 40 ? (airborneThisFlight ? "landing" : "takeoff") : (airborneThisFlight ? "taxi-in" : "taxi-out");
                if (blockIn > 0 && phase == "parked" && !engines) { /* stays parked until the next flight */ }
            }
            else
            {
                if (wasOnGround && gs > 30)
                {
                    takeoffAt = Now();
                    airborneThisFlight = true;
                    if (blockOut == 0)
                    {
                        blockOut = takeoffAt;
                        fuelAtBlockOut = v[V_FUEL];
                        FlightRec.Begin(blockOut, Sample(), PlanStr("from"), PlanStr("to"), PlanStr("flight"));
                    }
                    FlightRec.Takeoff(takeoffAt);
                }
                if (agl < 2500 && vs > 300) phase = "takeoff";
                else if (vs > 400) phase = "climb";
                else if (vs < -400 && agl < 6000) phase = "approach";
                else if (vs < -400) phase = "descent";
                else if (agl < 3000 && airborneThisFlight && takeoffAt > 0 && Now() - takeoffAt > 300000) phase = "approach";
                else phase = "cruise";
            }

            if (landingPending > 0 && --landingPending == 0)
            {
                double fpm = Math.Abs(v[V_TD_VEL]) * 60;
                var l = new Dictionary<string, object>();
                l["fpm"] = Math.Round(fpm);
                l["bank"] = Math.Round(v[V_TD_BANK], 1);
                l["pitch"] = Math.Round(v[V_TD_PITCH], 1);
                l["g"] = Math.Round(Math.Max(peakG, v[V_G]), 2);
                l["at"] = landingAt;
                l["rating"] = fpm < 60 ? "Butter" : fpm < 150 ? "Smooth" : fpm < 300 ? "Normal" : fpm < 500 ? "Firm" : "Hard";
                l["lat"] = tdLat; l["lon"] = tdLon; l["hdg"] = Math.Round(tdTrk); l["ias"] = Math.Round(tdIas);
                l["grade"] = Grade(l);
                lastLanding = l;
                FlightRec.Landing(l);
                Log.Write("Sim: landing " + Math.Round(fpm) + " fpm");
                // Where on the runway you touched down (reads the runway list, so not on the sim thread).
                double la = tdLat, lo = tdLon, hd = tdTrk;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    var td = Runways.Touchdown(la, lo, hd);
                    if (td == null) return;
                    lock (Gate)
                    {
                        foreach (var kv in td) l[kv.Key] = kv.Value;
                        l["grade"] = Grade(l);
                        FlightRec.Landing(l);
                    }
                    Log.Write("Sim: touchdown " + td["distM"] + " m down runway " + td["rwy"] + ", " + td["clM"] + " m from the centerline");
                });
            }

            // Where you flew: a point every 10 s (every 4 s near the ground), for the replay map.
            if (blockOut > 0 && blockIn == 0)
            {
                if (trackFor != blockOut) { trackPts = new List<double[]>(); trackFor = blockOut; trackAt = 0; }
                long now = Now();
                long every = ground ? 15000 : agl < 3000 ? 4000 : 10000;
                if (now - trackAt >= every && trackPts.Count < 8000)
                {
                    trackAt = now;
                    trackPts.Add(new[] { Math.Round((now - blockOut) / 1000.0), Math.Round(v[V_LAT], 5), Math.Round(v[V_LON], 5), Math.Round(v[V_ALT]), Math.Round(gs), Math.Round(vs) });
                }
            }

            // A new flight starts when you're parked with engines off after a logged flight,
            // or when you taxi off again without shutting down.
            if (blockIn > 0 && ground && ((!engines && Now() - blockIn > 60000) || (gs > 5 && Now() - blockIn > 30000)))
            {
                blockOut = takeoffAt = landingAt = blockIn = 0;
                airborneThisFlight = false;
            }
            wasOnGround = ground;
        }

        static readonly string LogPath = Path.Combine(Settings.Folder, "flightlog.json");
        static readonly string TrackDir = Path.Combine(Settings.Folder, "tracks");
        static List<double[]> trackPts = new List<double[]>();
        static long trackFor, trackAt;

        /// <summary>Flights that have a recorded track (newest first), plus the one you're flying now.</summary>
        public static List<Dictionary<string, object>> TrackList()
        {
            var list = new List<Dictionary<string, object>>();
            lock (Gate)
            {
                if (blockOut > 0 && blockIn == 0 && trackPts.Count > 1)
                {
                    var d = new Dictionary<string, object>();
                    d["id"] = "live"; d["from"] = PlanStr("from"); d["to"] = PlanStr("to"); d["date"] = blockOut; d["live"] = true;
                    list.Add(d);
                }
            }
            foreach (var o in ReadLog())
            {
                var e = o as Dictionary<string, object>;
                if (e == null || !e.ContainsKey("track")) continue;
                var d = new Dictionary<string, object>();
                foreach (var k in new[] { "track", "from", "to", "date", "flight", "aircraft", "fpm", "grade", "airMin" }) if (e.ContainsKey(k)) d[k == "track" ? "id" : k] = e[k];
                list.Add(d);
                if (list.Count >= 40) break;
            }
            return list;
        }

        /// <summary>The points of one flight: [seconds, lat, lon, alt ft, ground speed kt, vertical speed fpm].</summary>
        public static List<double[]> TrackData(string id)
        {
            if (id == "live") lock (Gate) return new List<double[]>(trackPts);
            if (string.IsNullOrEmpty(id) || id.Length > 20) return null;
            foreach (char c in id) if (c < '0' || c > '9') return null;
            try
            {
                string f = Path.Combine(TrackDir, id + ".json");
                if (!File.Exists(f)) return null;
                var raw = Json.Deserialize<List<List<double>>>(File.ReadAllText(f));
                var list = new List<double[]>();
                foreach (var r in raw) list.Add(r.ToArray());
                return list;
            }
            catch (Exception ex) { Log.Write("Track: " + ex.Message); return null; }
        }

        static void SaveTrack()
        {
            try
            {
                if (trackPts.Count < 2 || trackFor != blockOut) return;
                Directory.CreateDirectory(TrackDir);
                File.WriteAllText(Path.Combine(TrackDir, blockOut + ".json"), Json.Serialize(trackPts), new UTF8Encoding(false));
                // Keep the newest 40 flights.
                var files = new List<string>(Directory.GetFiles(TrackDir, "*.json"));
                files.Sort(StringComparer.Ordinal);
                while (files.Count > 40) { try { File.Delete(files[0]); } catch { } files.RemoveAt(0); }
            }
            catch (Exception ex) { Log.Write("Track save: " + ex.Message); }
        }
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

        static void WriteLog()
        {
            try
            {
                var list = ReadLog();
                var e = new Dictionary<string, object>();
                e["date"] = blockOut;
                e["from"] = PlanStr("from");
                e["to"] = PlanStr("to");
                e["flight"] = PlanStr("flight");
                e["aircraft"] = title;
                e["blockOut"] = blockOut; e["takeoff"] = takeoffAt; e["landing"] = landingAt; e["blockIn"] = blockIn;
                e["blockMin"] = Math.Round((blockIn - blockOut) / 60000.0);
                e["airMin"] = takeoffAt > 0 ? Math.Round((landingAt - takeoffAt) / 60000.0) : 0;
                e["fuelKg"] = Math.Round((fuelAtBlockOut - v[V_FUEL]) * 0.453592);
                if (lastLanding != null)
                {
                    e["fpm"] = lastLanding["fpm"]; e["rating"] = lastLanding["rating"]; e["g"] = lastLanding["g"]; e["grade"] = lastLanding["grade"];
                    object o;
                    if (lastLanding.TryGetValue("distM", out o)) e["tdM"] = o;
                    if (lastLanding.TryGetValue("rwy", out o)) e["rwy"] = o;
                    if (lastLanding.TryGetValue("clM", out o)) e["clM"] = o;
                }
                SaveTrack();
                if (trackPts.Count > 1 && trackFor == blockOut) e["track"] = blockOut.ToString();
                list.Insert(0, e);
                while (list.Count > 500) list.RemoveAt(list.Count - 1);
                Directory.CreateDirectory(Settings.Folder);
                File.WriteAllText(LogPath, Json.Serialize(list), new UTF8Encoding(false));
                Log.Write("Sim: flight logged " + e["from"] + "-" + e["to"]);
            }
            catch (Exception ex) { Log.Write("Sim: flight log: " + ex.Message); }
        }

        /// <summary>A school grade for the landing: how soft, how many G, where on the runway, how close to the centerline.</summary>
        static string Grade(Dictionary<string, object> l)
        {
            double fpm = Convert.ToDouble(l["fpm"]), g = Convert.ToDouble(l["g"]), bank = Math.Abs(Convert.ToDouble(l["bank"]));
            double score = fpm < 60 ? 100 : fpm < 120 ? 95 : fpm < 180 ? 88 : fpm < 240 ? 80 : fpm < 300 ? 72 : fpm < 400 ? 60 : fpm < 500 ? 45 : 25;
            if (g > 1.5) score -= 25; else if (g > 1.3) score -= 12; else if (g > 1.15) score -= 5;
            if (bank > 5) score -= 8;
            object o;
            if (l.TryGetValue("distM", out o))
            {
                double d = Convert.ToDouble(o);
                if (d < 150) score -= 15; else if (d > 900) score -= 18; else if (d > 600) score -= 8;
            }
            if (l.TryGetValue("clM", out o))
            {
                double c = Math.Abs(Convert.ToDouble(o));
                if (c > 10) score -= 15; else if (c > 6) score -= 8; else if (c > 3) score -= 4;
            }
            return score >= 95 ? "A+" : score >= 88 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 55 ? "D" : "F";
        }

        // ------------------------------------------------------------------ traffic around you

        static DateTime trafficWanted = DateTime.MinValue, trafficAsked = DateTime.MinValue;
        static List<Dictionary<string, object>> traffic = new List<Dictionary<string, object>>(), trafficBuild;

        static void AskTraffic()
        {
            if (!connected || sRequestByType == null || (DateTime.UtcNow - trafficWanted).TotalSeconds > 20 || (DateTime.UtcNow - trafficAsked).TotalSeconds < 5) return;
            trafficAsked = DateTime.UtcNow;
            lock (Gate)
            {
                if (trafficBuild != null) traffic = trafficBuild; // the last answer was incomplete (or empty)
                trafficBuild = new List<Dictionary<string, object>>();
            }
            lock (Io) sRequestByType(handle, REQ_TRAFFIC, DEF_TRAFFIC, 80000, SIMOBJECT_TYPE_AIRCRAFT);
        }

        static string Str(IntPtr data, int offset, int len)
        {
            var b = new byte[len];
            Marshal.Copy(new IntPtr(data.ToInt64() + offset), b, 0, len);
            int z = Array.IndexOf(b, (byte)0);
            return Encoding.UTF8.GetString(b, 0, z < 0 ? len : z).Trim();
        }

        static void ReadTraffic(IntPtr data, int entry, int outOf)
        {
            var raw = new byte[48];
            Marshal.Copy(new IntPtr(data.ToInt64() + 40), raw, 0, 48);
            double lat = BitConverter.ToDouble(raw, 0), lon = BitConverter.ToDouble(raw, 8);
            string id = Str(data, 88, 32), airline = Str(data, 120, 64), number = Str(data, 184, 8);
            lock (Gate)
            {
                if (trafficBuild == null) trafficBuild = new List<Dictionary<string, object>>();
                // Not you.
                bool me = Math.Abs(lat - v[V_LAT]) < 0.0003 && Math.Abs(lon - v[V_LON]) < 0.0003;
                if (!me && (lat != 0 || lon != 0) && trafficBuild.Count < 80)
                {
                    var t = new Dictionary<string, object>();
                    t["lat"] = lat; t["lon"] = lon;
                    t["alt"] = Math.Round(BitConverter.ToDouble(raw, 16));
                    t["hdg"] = Math.Round(BitConverter.ToDouble(raw, 24));
                    t["gs"] = Math.Round(BitConverter.ToDouble(raw, 32));
                    t["ground"] = BitConverter.ToDouble(raw, 40) > 0.5;
                    t["cs"] = airline.Length > 0 && number.Length > 0 ? airline + " " + number : id;
                    trafficBuild.Add(t);
                }
                if (entry >= outOf) { traffic = trafficBuild; trafficBuild = null; }
            }
        }

        /// <summary>Aircraft within about 80 km. Asking for it keeps the requests going for 20 seconds.</summary>
        public static List<Dictionary<string, object>> Traffic()
        {
            trafficWanted = DateTime.UtcNow;
            lock (Gate) return connected ? new List<Dictionary<string, object>>(traffic) : new List<Dictionary<string, object>>();
        }

        static string PlanStr(string k)
        {
            object o;
            return Plan != null && Plan.TryGetValue(k, out o) && o != null ? Convert.ToString(o) : "";
        }

        public static List<object> ReadLog()
        {
            try
            {
                if (!File.Exists(LogPath)) return new List<object>();
                var arr = Json.Deserialize<List<object>>(File.ReadAllText(LogPath, Encoding.UTF8));
                return arr ?? new List<object>();
            }
            catch { return new List<object>(); }
        }

        // ------------------------------------------------------------------ for the widget

        public static Dictionary<string, object> State()
        {
            var d = new Dictionary<string, object>();
            lock (Gate)
            {
                bool fresh = connected && (DateTime.UtcNow - lastData).TotalSeconds < 5;
                d["dll"] = DllFound;
                d["running"] = msfsRunning || connected;
                d["connected"] = fresh;
                d["status"] = status;
                if (lastLanding != null) d["landing"] = new Dictionary<string, object>(lastLanding); // a copy: the runway details may be added meanwhile
                if (blockOut > 0) d["blockOut"] = blockOut;
                if (takeoffAt > 0) d["takeoff"] = takeoffAt;
                if (landingAt > 0) d["landed"] = landingAt;
                if (blockIn > 0) d["blockIn"] = blockIn;
                if (!fresh) return d;
                d["title"] = title;
                d["lat"] = v[V_LAT]; d["lon"] = v[V_LON];
                d["alt"] = Math.Round(v[V_ALT]); d["agl"] = Math.Round(v[V_AGL]);
                d["ias"] = Math.Round(v[V_IAS]); d["gs"] = Math.Round(v[V_GS]);
                d["vs"] = Math.Round(v[V_VS]); d["hdg"] = Math.Round(v[V_HDG]); d["trk"] = Math.Round(v[V_TRK]);
                d["ground"] = v[V_GROUND] > 0.5;
                d["fuelKg"] = Math.Round(v[V_FUEL] * 0.453592);
                d["ffKgH"] = Math.Round((v[V_FF1] + v[V_FF1 + 1] + v[V_FF1 + 2] + v[V_FF1 + 3]) * 0.453592);
                d["park"] = v[V_PARK] > 0.5;
                d["com1"] = Math.Round(v[V_COM1], 3); d["com1s"] = Math.Round(v[V_COM1S], 3); d["com2"] = Math.Round(v[V_COM2], 3);
                d["xpdr"] = (int)Math.Round(v[V_XPDR]);
                d["zulu"] = Math.Round(v[V_ZULU]); d["local"] = Math.Round(v[V_LOCAL]);
                d["rate"] = v[V_RATE];
                d["camera"] = (int)v[V_CAM];
                d["paused"] = paused;
                d["phase"] = phase;
            }
            return d;
        }

        public static bool Do(string what, int value)
        {
            if (!connected) return false;
            lock (Io)
            {
                switch (what)
                {
                    case "pause": return sTransmit(handle, USER, EV_PAUSE_TOGGLE, 0, 1, 0x10) == 0;
                    case "rateUp": return sTransmit(handle, USER, EV_RATE_UP, 0, 1, 0x10) == 0;
                    case "rateDown": return sTransmit(handle, USER, EV_RATE_DOWN, 0, 1, 0x10) == 0;
                    case "camera":
                        if (value < 2 || value > 9) return false;
                        IntPtr buf = Marshal.AllocHGlobal(8);
                        try
                        {
                            Marshal.Copy(BitConverter.GetBytes((double)value), 0, buf, 8);
                            return sSetData(handle, DEF_CAMERA, USER, 0, 0, 8, buf) == 0;
                        }
                        finally { Marshal.FreeHGlobal(buf); }
                    default: return false;
                }
            }
        }
    }

    /// <summary>Airport frequencies from OurAirports (free, public data), downloaded once a month.</summary>
    static class Freqs
    {
        static readonly string FilePath = Path.Combine(Settings.Folder, "airport-frequencies.csv");
        const string Url = "https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv";
        static readonly object Gate = new object();

        public static List<Dictionary<string, object>> For(string icao)
        {
            var list = new List<Dictionary<string, object>>();
            if (string.IsNullOrEmpty(icao) || icao.Length > 8) return list;
            icao = icao.ToUpperInvariant();
            lock (Gate)
            {
                try
                {
                    if (!File.Exists(FilePath) || (DateTime.UtcNow - File.GetLastWriteTimeUtc(FilePath)).TotalDays > 30)
                    {
                        string type;
                        var data = WebGet.Download(Url, out type);
                        if (data != null && data.Length > 100000) { Directory.CreateDirectory(Settings.Folder); File.WriteAllBytes(FilePath, data); }
                    }
                    if (!File.Exists(FilePath)) return list;
                    string needle = ",\"" + icao + "\",";
                    foreach (var line in File.ReadLines(FilePath))
                    {
                        if (line.IndexOf(needle, StringComparison.Ordinal) < 0) continue;
                        // id,"airport_ref","airport_ident","type","description","frequency_mhz"
                        var f = SplitCsv(line);
                        if (f.Count < 6 || f[2] != icao) continue;
                        var d = new Dictionary<string, object>();
                        d["type"] = f[3]; d["desc"] = f[4]; d["mhz"] = f[5];
                        list.Add(d);
                    }
                }
                catch (Exception ex) { Log.Write("Frequencies: " + ex.Message); }
            }
            return list;
        }

        internal static List<string> SplitCsv(string line)
        {
            var outList = new List<string>();
            var sb = new StringBuilder();
            bool q = false;
            foreach (char c in line)
            {
                if (c == '"') q = !q;
                else if (c == ',' && !q) { outList.Add(sb.ToString()); sb.Length = 0; }
                else sb.Append(c);
            }
            outList.Add(sb.ToString());
            return outList;
        }
    }

    /// <summary>Runways from OurAirports (free, public data), downloaded once a month: ends, headings, length.</summary>
    static class Runways
    {
        static readonly string FilePath = Path.Combine(Settings.Folder, "runways.csv");

        /// <summary>Rough position (first runway end) of each airport code, for the logbook map.</summary>
        public static Dictionary<string, double[]> Locate(IEnumerable<string> codes)
        {
            var want = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var c in codes) if (!string.IsNullOrEmpty(c) && c.Length <= 8) want.Add(c.ToUpperInvariant());
            var res = new Dictionary<string, double[]>();
            if (want.Count == 0) return res;
            lock (Gate)
            {
                try
                {
                    if (!Ensure()) return res;
                    foreach (var line in File.ReadLines(FilePath))
                    {
                        var f = Freqs.SplitCsv(line);
                        if (f.Count < 11 || !want.Contains(f[2]) || res.ContainsKey(f[2])) continue;
                        double la = D(f[9]), lo = D(f[10]);
                        if (double.IsNaN(la) || double.IsNaN(lo)) continue;
                        res[f[2].ToUpperInvariant()] = new[] { Math.Round(la, 4), Math.Round(lo, 4) };
                        if (res.Count == want.Count) break;
                    }
                }
                catch (Exception ex) { Log.Write("Airport positions: " + ex.Message); }
            }
            return res;
        }

        static HashSet<string> idents;
        /// <summary>Every airport code that has a runway (from the OurAirports list), for telling "EKCH" from other words.</summary>
        public static HashSet<string> Idents()
        {
            lock (Gate)
            {
                if (idents != null) return idents;
                var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                try
                {
                    if (Ensure())
                        foreach (var line in File.ReadLines(FilePath))
                        {
                            var f = Freqs.SplitCsv(line);
                            if (f.Count > 2 && f[2].Length >= 3 && f[2].Length <= 4) set.Add(f[2]);
                        }
                }
                catch (Exception ex) { Log.Write("Airport list: " + ex.Message); }
                if (set.Count > 1000) idents = set;
                return set;
            }
        }
        const string Url = "https://davidmegginson.github.io/ourairports-data/runways.csv";
        static readonly object Gate = new object();
        static readonly Dictionary<string, List<Dictionary<string, object>>> cache = new Dictionary<string, List<Dictionary<string, object>>>();

        static bool Ensure()
        {
            if (!File.Exists(FilePath) || (DateTime.UtcNow - File.GetLastWriteTimeUtc(FilePath)).TotalDays > 30)
            {
                string type;
                var data = WebGet.Download(Url, out type);
                if (data != null && data.Length > 500000) { Directory.CreateDirectory(Settings.Folder); File.WriteAllBytes(FilePath, data); cache.Clear(); }
            }
            return File.Exists(FilePath);
        }

        static double D(string s)
        {
            double d;
            return double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d) ? d : double.NaN;
        }

        // id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed,le_ident,le_lat,le_lon,le_elev,le_hdg,le_disp,he_ident,he_lat,he_lon,he_elev,he_hdg,he_disp
        static Dictionary<string, object> Parse(List<string> f)
        {
            if (f.Count < 20 || f[7] == "1") return null;
            double la1 = D(f[9]), lo1 = D(f[10]), la2 = D(f[15]), lo2 = D(f[16]);
            if (double.IsNaN(la1) || double.IsNaN(lo1) || double.IsNaN(la2) || double.IsNaN(lo2)) return null;
            var r = new Dictionary<string, object>();
            r["airport"] = f[2];
            r["ident"] = f[8] + "/" + f[14];
            r["lengthFt"] = double.IsNaN(D(f[3])) ? 0 : D(f[3]);
            r["widthFt"] = double.IsNaN(D(f[4])) ? 0 : D(f[4]);
            r["surface"] = f[5];
            var ends = new List<Dictionary<string, object>>();
            for (int k = 0; k < 2; k++)
            {
                int o = k == 0 ? 8 : 14;
                var e = new Dictionary<string, object>();
                e["id"] = f[o]; e["lat"] = D(f[o + 1]); e["lon"] = D(f[o + 2]);
                double el = D(f[o + 3]), hd = D(f[o + 4]), ds = D(f[o + 5]);
                e["elev"] = double.IsNaN(el) ? 0 : el;
                e["hdg"] = double.IsNaN(hd) ? Bearing(D(f[o + 1]), D(f[o + 2]), D(f[k == 0 ? 15 : 9]), D(f[k == 0 ? 16 : 10])) : hd;
                e["dispFt"] = double.IsNaN(ds) ? 0 : ds;
                ends.Add(e);
            }
            r["ends"] = ends;
            return r;
        }

        static double Bearing(double la1, double lo1, double la2, double lo2)
        {
            double r = Math.PI / 180, y = Math.Sin((lo2 - lo1) * r) * Math.Cos(la2 * r);
            double x = Math.Cos(la1 * r) * Math.Sin(la2 * r) - Math.Sin(la1 * r) * Math.Cos(la2 * r) * Math.Cos((lo2 - lo1) * r);
            return (Math.Atan2(y, x) / r + 360) % 360;
        }

        public static List<Dictionary<string, object>> For(string icao)
        {
            var list = new List<Dictionary<string, object>>();
            if (string.IsNullOrEmpty(icao) || icao.Length > 8) return list;
            icao = icao.ToUpperInvariant();
            lock (Gate)
            {
                List<Dictionary<string, object>> c;
                if (cache.TryGetValue(icao, out c)) return c;
                try
                {
                    if (!Ensure()) return list;
                    string needle = ",\"" + icao + "\",";
                    foreach (var line in File.ReadLines(FilePath))
                    {
                        if (line.IndexOf(needle, StringComparison.Ordinal) < 0) continue;
                        var f = Freqs.SplitCsv(line);
                        if (f.Count < 20 || f[2] != icao) continue;
                        var r = Parse(f);
                        if (r != null) list.Add(r);
                    }
                    cache[icao] = list;
                }
                catch (Exception ex) { Log.Write("Runways: " + ex.Message); }
            }
            return list;
        }

        // Runway ends (airport, lat1, lon1, lat2, lon2), read from runways.csv once and kept, for Nearest.
        static List<string> endsApt;
        static List<double[]> endsPos;
        static Dictionary<string, double> endsLen;   // longest runway per airport, feet
        static DateTime endsAt = DateTime.MinValue;
        // Let go of the list 5 minutes after the last lookup (a few MB that are only needed around a flight's start and end).
        static readonly Timer endsDrop = new Timer(delegate { lock (Gate) { endsApt = null; endsPos = null; endsLen = null; } }, null, Timeout.Infinite, Timeout.Infinite);

        /// <summary>The longest runway of each airport (feet), or null if the runway list isn't there.</summary>
        public static Dictionary<string, double> MaxLengths()
        {
            lock (Gate)
            {
                LoadEnds();
                endsDrop.Change(300000, Timeout.Infinite);
                return endsLen;
            }
        }

        /// <summary>Where an airport is (its first runway end), or null.</summary>
        public static double[] Position(string icao)
        {
            if (string.IsNullOrEmpty(icao)) return null;
            lock (Gate)
            {
                LoadEnds();
                endsDrop.Change(300000, Timeout.Infinite);
                if (endsApt == null) return null;
                int i = endsApt.IndexOf(icao.ToUpperInvariant());
                return i < 0 ? null : new[] { endsPos[i][0], endsPos[i][1] };
            }
        }

        static void LoadEnds()
        {
            if (endsPos != null && File.Exists(FilePath) && File.GetLastWriteTimeUtc(FilePath) <= endsAt) return;
            if (!Ensure()) return;
            var apts = new List<string>(50000);
            var pos = new List<double[]>(50000);
            var len = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in File.ReadLines(FilePath))
            {
                var f = Freqs.SplitCsv(line);
                if (f.Count < 17 || f[7] == "1") continue;
                double la1 = D(f[9]), lo1 = D(f[10]), la2 = D(f[15]), lo2 = D(f[16]);
                if (double.IsNaN(la1) || double.IsNaN(lo1)) continue;
                if (double.IsNaN(la2) || double.IsNaN(lo2)) { la2 = la1; lo2 = lo1; }
                string code = f[2].ToUpperInvariant();
                apts.Add(code);
                pos.Add(new[] { la1, lo1, la2, lo2 });
                double ft = D(f[3]), had;
                if (!double.IsNaN(ft) && (!len.TryGetValue(code, out had) || ft > had)) len[code] = ft;
            }
            endsApt = apts;
            endsPos = pos;
            endsLen = len;
            endsAt = File.GetLastWriteTimeUtc(FilePath);
        }

        /// <summary>The airport with a runway nearest to a spot (within maxMeters), e.g. where a flight started. Null if none.</summary>
        public static string Nearest(double lat, double lon, double maxMeters)
        {
            try
            {
                List<string> apts;
                List<double[]> pos;
                lock (Gate)
                {
                    LoadEnds();
                    endsDrop.Change(300000, Timeout.Infinite);
                    apts = endsApt;
                    pos = endsPos;
                }
                if (pos == null) return null;
                string best = null;
                double bestD = maxMeters;
                double mPerLat = 111320, mPerLon = 111320 * Math.Cos(lat * Math.PI / 180);
                for (int i = 0; i < pos.Count; i++)
                {
                    var r = pos[i];
                    if (Math.Abs(r[0] - lat) > 0.1 || Math.Abs(r[1] - lon) > 0.2) continue;
                    // Distance to the runway (as a line between its two ends).
                    double bx = (r[3] - r[1]) * mPerLon, by = (r[2] - r[0]) * mPerLat, px = (lon - r[1]) * mPerLon, py = (lat - r[0]) * mPerLat;
                    double len2 = bx * bx + by * by, t = len2 > 0 ? Math.Max(0, Math.Min(1, (px * bx + py * by) / len2)) : 0;
                    double dx = px - t * bx, dy = py - t * by, d = Math.Sqrt(dx * dx + dy * dy);
                    if (d < bestD) { bestD = d; best = apts[i]; }
                }
                return best;
            }
            catch (Exception ex) { Log.Write("Nearest airport: " + ex.Message); return null; }
        }

        /// <summary>Which runway you landed on, how far past the threshold and how far from the centerline (meters).</summary>
        public static Dictionary<string, object> Touchdown(double lat, double lon, double trk)
        {
            try
            {
                lock (Gate) { if (!Ensure()) return null; }
                Dictionary<string, object> best = null;
                double bestCl = double.MaxValue;
                double mPerLat = 111320, mPerLon = 111320 * Math.Cos(lat * Math.PI / 180);
                foreach (var line in File.ReadLines(FilePath))
                {
                    var f = Freqs.SplitCsv(line);
                    if (f.Count < 20) continue;
                    double la1 = D(f[9]), lo1 = D(f[10]), la2 = D(f[15]), lo2 = D(f[16]);
                    if (double.IsNaN(la1) || double.IsNaN(la2) || Math.Abs(la1 - lat) > 0.06 || Math.Abs(lo1 - lon) > 0.1) continue;
                    var r = Parse(f);
                    if (r == null) continue;
                    var ends = (List<Dictionary<string, object>>)r["ends"];
                    for (int k = 0; k < 2; k++)
                    {
                        var t = ends[k]; var o = ends[1 - k];
                        double tx = 0, ty = 0;
                        double ox = ((double)o["lon"] - (double)t["lon"]) * mPerLon, oy = ((double)o["lat"] - (double)t["lat"]) * mPerLat;
                        double px = (lon - (double)t["lon"]) * mPerLon, py = (lat - (double)t["lat"]) * mPerLat;
                        double len = Math.Sqrt(ox * ox + oy * oy);
                        if (len < 100) continue;
                        double ux = ox / len, uy = oy / len;
                        double along = (px - tx) * ux + (py - ty) * uy, cross = (px - tx) * uy - (py - ty) * ux; // + = right of centerline
                        double dir = (Math.Atan2(ux, uy) * 180 / Math.PI + 360) % 360;
                        double diff = Math.Abs(((trk - dir) % 360 + 540) % 360 - 180);
                        if (diff > 30 || Math.Abs(cross) > 80 || along < -300 || along > len + 100) continue;
                        if (Math.Abs(cross) < bestCl)
                        {
                            bestCl = Math.Abs(cross);
                            best = new Dictionary<string, object>();
                            best["rwy"] = t["id"];
                            best["airport"] = r["airport"];
                            best["distM"] = Math.Round(along - (double)t["dispFt"] * 0.3048);
                            best["clM"] = Math.Round(cross, 1);
                            best["lengthM"] = Math.Round(len);
                            best["dispM"] = Math.Round((double)t["dispFt"] * 0.3048);
                        }
                    }
                }
                return best;
            }
            catch (Exception ex) { Log.Write("Touchdown: " + ex.Message); return null; }
        }
    }
}
