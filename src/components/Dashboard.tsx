type Todo = {
  id: number;
  name: string;
};

type DashboardProps = {
  todos: Todo[];
  logout: () => void;
};

export default function Dashboard({
  todos,
  logout,
}: DashboardProps) {
  return (
    <div style={{ padding: '20px' }}>
      <h1>Web Dashboard</h1>

      <button onClick={logout}>
        Logout
      </button>

      <h2>Todo List</h2>

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            {todo.name}
          </li>
        ))}
      </ul>
    </div>
  );
}