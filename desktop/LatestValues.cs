namespace Deckwell;

/// Keeps only the newest value for each key until it is taken. Used for slider moves: the deck can send a new
/// position every 30 ms, and only the newest one matters, so a slow audio call never builds a backlog.
/// Platform-neutral so it can be unit tested.
public sealed class LatestValues<TKey, TValue> where TKey : notnull
{
    readonly Dictionary<TKey, TValue> _items = new();
    readonly object _lock = new();

    /// Replaces any value not yet taken for this key.
    public void Set(TKey key, TValue value) { lock (_lock) _items[key] = value; }

    public bool IsEmpty { get { lock (_lock) return _items.Count == 0; } }

    /// Removes and returns everything waiting: one entry per key, each with its newest value.
    public List<KeyValuePair<TKey, TValue>> TakeAll()
    {
        lock (_lock)
        {
            var list = _items.ToList();
            _items.Clear();
            return list;
        }
    }
}
