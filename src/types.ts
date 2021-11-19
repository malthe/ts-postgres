export enum DataType {
    Bool = 16,
    Bytea = 17,
    Char = 18,
    Name = 19,
    Int8 = 20,
    Int2 = 21,
    Int4 = 23,
    Regproc = 24,
    Text = 25,
    Oid = 26,
    Tid = 27,
    Xid = 28,
    Cid = 29,
    PgDdlCommand = 32,
    Json = 114,
    Xml = 142,
    PgNodeTree = 194,
    ArrayJson = 199,
    Smgr = 210,
    IndexAmHandler = 325,
    Point = 600,
    Lseg = 601,
    Path = 602,
    Box = 603,
    Polygon = 604,
    Line = 628,
    Cidr = 650,
    Float4 = 700,
    Float8 = 701,
    Abstime = 702,
    Reltime = 703,
    Tinterval = 704,
    Unknown = 705,
    Circle = 718,
    Macaddr8 = 774,
    Money = 790,
    Macaddr = 829,
    Inet = 869,
    ArrayBytea = 1001,
    ArrayChar = 1002,
    ArrayInt4 = 1007,
    ArrayRegprocedure = 1008,
    ArrayText = 1009,
    ArrayBpchar = 1014,
    ArrayVarchar = 1015,
    ArrayFloat4 = 1021,
    ArrayFloat8 = 1022,
    _Text = 1009,
    _Oid = 1028,
    Aclitem = 1033,
    Bpchar = 1042,
    Varchar = 1043,
    Date = 1082,
    Time = 1083,
    Timestamp = 1114,
    ArrayTimestamp = 1115,
    ArrayDate = 1182,
    Timestamptz = 1184,
    ArrayTimestamptz = 1185,
    Interval = 1186,
    Timetz = 1266,
    Bit = 1560,
    Varbit = 1562,
    Numeric = 1700,
    Refcursor = 1790,
    Regprocedure = 2202,
    Regoper = 2203,
    Regoperator = 2204,
    Regclass = 2205,
    Regtype = 2206,
    Record = 2249,
    Cstring = 2275,
    Any = 2276,
    Anyarray = 2277,
    Void = 2278,
    Trigger = 2279,
    LanguageHandler = 2280,
    Internal = 2281,
    Opaque = 2282,
    AnyElement = 2283,
    AnyNonArray = 2776,
    Uuid = 2950,
    ArrayUuid = 2951,
    TxidSnapshot = 2970,
    FdwHandler = 3115,
    PgLsn = 3220,
    TsmHandler = 3310,
    PgNdistinct = 3361,
    PgDependencies = 3402,
    Anyenum = 3500,
    Tsvector = 3614,
    Tsquery = 3615,
    GtsVector = 3642,
    Regconfig = 3734,
    Regdictionary = 3769,
    Jsonb = 3802,
    ArrayJsonb = 3807,
    Anyrange = 3831,
    EventTrigger = 3838,
    Regnamespace = 4089,
    Regrole = 4096,
    MinUserOid = 16384,
}

export const arrayDataTypeMapping: ReadonlyMap<DataType, DataType> = new Map([
    [DataType.ArrayBpchar, DataType.Bpchar],
    [DataType.ArrayBytea, DataType.Bytea],
    [DataType.ArrayChar, DataType.Char],
    [DataType.ArrayDate, DataType.Date],
    [DataType.ArrayFloat4, DataType.Float4],
    [DataType.ArrayFloat8, DataType.Float8],
    [DataType.ArrayInt4, DataType.Int4],
    [DataType.ArrayJson, DataType.Json],
    [DataType.ArrayJsonb, DataType.Jsonb],
    [DataType.ArrayText, DataType.Text],
    [DataType.ArrayTimestamp, DataType.Timestamp],
    [DataType.ArrayTimestamptz, DataType.Timestamptz],
    [DataType.ArrayUuid, DataType.Uuid],
    [DataType.ArrayVarchar, DataType.Varchar]
]);

export enum DataFormat {
    Text,
    Binary,
}

export type ValueTypeReader = (
    buffer: Buffer,
    start: number,
    end: number,
    format: DataFormat,
    encoding?: BufferEncoding
) => Value;

export interface Point {
    x: number,
    y: number
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function isPoint(item: any): item is Point {
    return 'x' in item && 'y' in item;
}

export type Builtin =
    Buffer |
    Date |
    BigInt |
    boolean |
    number |
    null |
    string;

export type AnyJson = boolean | number | string | null | JsonArray | JsonMap;

export interface JsonMap { [key: string]: AnyJson; }

export type JsonArray = Array<AnyJson>;

export type ArrayValue<T> = Array<ArrayValue<T> | T>;

export type Primitive = Builtin | Point | JsonMap;

export type Value = Primitive | ArrayValue<Primitive>;

export type Row = ArrayValue<Primitive>;
