import requests

cookies = {'session_token': 'test_token'}
todo_data = {
    'id': 'test-todo-prio-3',
    'text': 'Priority Test',
    'parent_id': None,
    'completed': False,
    'tags': [],
    'priority': 2
}

print("Creating todo with priority 2...")
res = requests.post('http://localhost:8000/api/todos', json=todo_data, cookies=cookies)
print("POST status:", res.status_code)

print("\nUpdating todo to priority 5...")
res_update = requests.put('http://localhost:8000/api/todos/test-todo-prio-3', json={'priority': 5}, cookies=cookies)
print("PUT status:", res_update.status_code)

print("\nFetching todos to verify...")
res_get = requests.get('http://localhost:8000/api/todos', cookies=cookies)
print("GET status:", res_get.status_code)

todos = res_get.json()
test_todo = next((t for t in todos if t['id'] == 'test-todo-prio'), None)

if test_todo:
    print(f"Success: Found priority = {test_todo.get('priority')}")
else:
    print("Error: Todo not found.")
