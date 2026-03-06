import requests

cookies = {'session_token': 'test_token'}
todo_data = {
    'id': 'test-todo-1',
    'text': 'Hello World',
    'parent_id': None,
    'completed': False,
    'tags': ['test']
}
res = requests.post('http://localhost:8000/api/todos', json=todo_data, cookies=cookies)
print("POST status:", res.status_code)
print("POST body:", res.text)

res2 = requests.get('http://localhost:8000/api/todos', cookies=cookies)
print("GET status:", res2.status_code)
print("GET body:", res2.text)
